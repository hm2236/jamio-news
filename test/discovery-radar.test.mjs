import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import {EventEmitter} from 'node:events';
import {canonical,digest,publicAddress,endpointAllowed,validateSourceConfig,pinnedRequest,createSourceFetcher,sourceTime,hnRecord,parseXml,feedRecords,htmlRecords,observation,emptyState,updateSeen,seenRecords,compactState,validateState,validateCandidate,recoverState,capture,planRecovery,packageCapture,payloadBytes,scheduledSlot,jstDate,validateContract,outputBase,WORKFLOW,REPOSITORY,ROLLING_BUDGET,CHECKPOINT_BUDGET} from '../scripts/discovery-radar.mjs';
const config = JSON.parse(fs.readFileSync(new URL('../config/discovery-radar-sources.json',import.meta.url),'utf8'));
const [hn,rss,html] = config.sources;
const at = '2026-10-06T12:17:00.000Z', later = '2026-10-06T12:17:01.000Z', now = Date.parse(later);
const compatibility = {contractDigest:digest('contract-fixture'),sourceConfigDigest:digest('config-fixture')};
const item = (id=123,title='Fixture title') => ({id,type:'story',by:'fixture',time:1791289000,title,url:'https://untrusted.invalid/story',text:'ephemeral text',score:10,descendants:2});
const obs = (id=123,title='Fixture title',time=at,source=hn) => observation(hnRecord(item(id,title),id).record,source,time,time);
const atom = '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://purl.org/dc/elements/1.1/"><entry><d:id>stable-1</d:id><title><![CDATA[Fixture & text]]></title><d:link href="/test.html"/><d:date>2026-10-06</d:date><summary>A &amp; B &#x65E5;</summary></entry></feed>';
const rssFixture = '<rss version="2.0"><channel><item><guid>stable-1</guid><title>A &amp; B</title><link>https://www.pref.kagoshima.jp/test.html</link><pubDate>Tue, 06 Oct 2026 12:00:00 GMT</pubDate><description>Short metadata</description></item></channel></rss>';
const rdf = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel rdf:about="https://www.pref.kagoshima.jp/saishin/index.html"><items><rdf:Seq><rdf:li rdf:resource="https://www.pref.kagoshima.jp/test.html"/></rdf:Seq></items></channel><item rdf:about="urn:fixture:1"><title>Example</title><link>https://www.pref.kagoshima.jp/test.html</link><dc:date>2026-10-06</dc:date></item></rdf:RDF>';
const htmlFixture = '<html><body><a href="/news/test-story" class="PublicationList-module__hash__listItem"><div><time>Oct 6, 2026</time></div><span class="PublicationList-module__hash__title body-3">Fixture &amp; title</span></a></body></html>';
const run = (id=10,overrides={}) => ({id,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',path:WORKFLOW,repository:{full_name:REPOSITORY},created_at:at,status:'completed',conclusion:'success',event:'schedule',...overrides});
function candidate(kind='rolling',id=10) {
  const state = emptyState(); updateSeen(state,[obs()],now);
  const stateBytes = brotliCompressSync(canonical(state)+'\n');
  const r = run(id);
  const m = {version:1,kind,repository:REPOSITORY,workflow:WORKFLOW,branch:'main',producer:{runId:String(id),attempt:1,headSha:r.head_sha},startedAt:at,completedAt:later,githubRetentionDays:90,retentionCapability:'ok',...compatibility,previousStateDigest:null,stateDigest:digest(state),payloadDigest:digest(stateBytes),stateEncoding:'brotli-canonical-json-v1',imported:null,coldStart:true,health:'degraded'};
  return {kind,artifactId:id+100,runId:String(id),attempt:1,run:r,manifest:{...m,manifestDigest:digest(m)},stateBytes};
}
function resign(c) { const {manifestDigest,...m} = c.manifest; c.manifest.manifestDigest=digest(m); }
test('canonical JSON sorts recursively, uses deterministic LF serialization and forbids invalid numbers',()=>{
  assert.equal(canonical({b:[{z:1,a:2}],a:0}),'{"a":0,"b":[{"a":2,"z":1}]}');
  assert.equal(digest({b:2,a:1}),digest({a:1,b:2})); assert.throws(()=>canonical({a:undefined})); assert.throws(()=>canonical(NaN));
});
test('semantic HN digest excludes popularity, and canonical identity always stays on HN',()=>{
  const a=obs(),b=observation(hnRecord({...item(),score:999,descendants:400},123).record,hn,later,later);
  assert.equal(a.observationId,b.observationId); assert.equal(a.contentDigest,b.contentDigest);
  assert.equal(a.canonicalUrl,'https://news.ycombinator.com/item?id=123'); assert.deepEqual(a.discoveredUrls,['https://untrusted.invalid/story']);
  assert.notEqual(a.observationId,obs(123,'Changed').observationId); assert.notEqual(a.observationId,obs(123,'Fixture title',at,{...hn,id:'kagoshima-new'}).observationId);
});
test('source dates keep date precision, RFC dates retain time, unknown stays null; invalid date fails',()=>{
  assert.deepEqual(sourceTime('2026-10-06'),{at:'2026-10-06',precision:'date'});
  assert.equal(sourceTime('Tue, 06 Oct 2026 12:00:00 GMT').precision,'datetime'); assert.equal(sourceTime(null).at,null);
  assert.throws(()=>sourceTime('2026-02-30')); assert.throws(()=>sourceTime('today')); assert.throws(()=>observation(hnRecord(item(),123).record,hn,later,at));
});
test('HN missing, dead, deleted and non-story items are classified; bad shape and oversized fields fail',()=>{
  assert.equal(hnRecord(null,123).status,'missing'); assert.equal(hnRecord({...item(),deleted:true},123).status,'deleted'); assert.equal(hnRecord({...item(),dead:true},123).status,'dead');
  assert.equal(hnRecord({...item(),type:'comment'},123).status,'unsupported-type');
  for (const bad of [{...item(),id:124},{...item(),time:'bad'},{...item(),title:'x'.repeat(1025)},{...item(),text:'x'.repeat(8193)},{...item(),url:'https://user:secret@example.com'},{...item(),url:'https://example.com/?token=secret'}]) assert.throws(()=>hnRecord(bad,123));
});
for (const [name,body] of [['RSS',rssFixture],['Atom namespace CDATA and numeric entity',atom],['RDF channel sequence',rdf]]) test(`bounded ${name} normalizes metadata without retaining the body`,()=>{
  const rows=feedRecords(body,rss); assert.equal(rows.length,1); assert.equal(rows[0].canonicalUrl,'https://www.pref.kagoshima.jp/test.html'); assert.ok(rows[0].sourceItemId); assert.ok(rows[0].published); assert.ok(!Object.hasOwn(rows[0],'body'));
});
for (const [name,body] of [
  ['DOCTYPE','<!DOCTYPE rss SYSTEM "https://evil.invalid"><rss version="2.0"/>'],['ENTITY','<!ENTITY x "secret"><rss version="2.0"/>'],['unclosed',rssFixture.replace('</item>','')],['nested item',rssFixture.replace('<guid>','<item/><guid>')],['nested entry',atom.replace('<title>','<entry/><title>')],['unknown entity',rssFixture.replace('A &amp; B','A &evil; B')],['bare ampersand',rssFixture.replace('A &amp; B','A & B')],['unknown prefix',rssFixture.replace('<guid>stable-1</guid>','<bad:guid>stable-1</bad:guid>')],['duplicate attribute','<rss version="2.0" version="2.0"/>'],['wrong root','<html/>'],['unknown dialect','<rss version="9.9"/>'],['field bound',rssFixture.replace('Short metadata','x'.repeat(17000))],['item bound','<rss version="2.0"><channel>'+rssFixture.match(/<item>[\s\S]*<\/item>/)[0].repeat(101)+'</channel></rss>'],['unclosed CDATA',atom.replace(']]>','')],['nested field',rssFixture.replace('Short metadata','<b>nested</b>')]
]) test(`XML rejects ${name}`,()=>assert.throws(()=>feedRecords(body,rss)));
test('empty valid feed is empty; generic query stripping and guessed HTTPS upgrades are forbidden',()=>{
  assert.deepEqual(feedRecords('<rss version="2.0"><channel/></rss>',rss),[]);
  const http=rssFixture.replace('https://www.pref','http://www.pref'); assert.throws(()=>feedRecords(http,rss),/equivalence/);
  const proof={sourceUrl:'http://www.pref.kagoshima.jp/test.html',httpsUrl:'https://www.pref.kagoshima.jp/test.html',method:'visible-text-and-canonical-url',httpStatus:200,httpsStatus:200,normalizedTextDigest:digest('equal'),verifiedAt:at};
  const row=feedRecords(http,{...rss,httpsEquivalence:[proof]})[0]; assert.equal(row.sourceUrl,proof.sourceUrl); assert.equal(row.canonicalUrl,proof.httpsUrl);
  assert.throws(()=>feedRecords(rssFixture.replace('/test.html','/test.html?x=1'),rss),/url-policy/);
  let count=0; assert.deepEqual(feedRecords(http,rss,()=>count++),[]); assert.equal(count,1);
});
const replaceTitle = value => rssFixture.replace('A &amp; B',value);
const withAttribute = value => rssFixture.replace('<link>https://www.pref.kagoshima.jp/test.html</link>',`<link ${value}/>`);
const withRoot = value => rssFixture.replace('<rss version="2.0">',value);
const invalidXml = [
  ['review bare attribute entity',withAttribute('href="https://www.pref.kagoshima.jp/test&ampbroken.html"')],
  ['review text CDATA delimiter',replaceTitle('Example ]]> suffix')],
  ['unquoted attribute',withAttribute('href=/test.html')],
  ['broken attribute quote',withAttribute('href="/test.html')],
  ['duplicate attribute',withAttribute('href="/test.html" href="/other.html"')],
  ['missing attribute separator',withAttribute('href="/test.html"rel="alternate"')],
  ['missing attribute equals',withAttribute('href "/test.html"')],
  ['empty attribute name',withAttribute('="/test.html"')],
  ['illegal attribute name',withAttribute('1href="/test.html"')],
  ['multiple attribute colons',withAttribute('xml:a:b="x" href="/test.html"')],
  ['literal attribute less-than',withAttribute('href="/test<.html"')],
  ['illegal attribute whitespace',withAttribute('\u00a0href="/test.html"')],
  ['unknown attribute entity',withAttribute('href="/test&evil;.html"')],
  ['empty attribute entity',withAttribute('href="/test&;.html"')],
  ['attribute null entity',withAttribute('href="/test&#0;.html"')],
  ['attribute noncharacter entity',withAttribute('href="/test&#xFFFF;.html"')],
  ['expanded duplicate attribute',withRoot('<rss version="2.0" xmlns:d="http://purl.org/dc/elements/1.1/" xmlns:dc="http://purl.org/dc/elements/1.1/" d:id="1" dc:id="2">')],
  ['missing entity semicolon',replaceTitle('A &amp B')],
  ['broken numeric entity',replaceTitle('A &#xGG;')],
  ['uppercase numeric marker',replaceTitle('A &#X41;')],
  ['HTML-only entity',replaceTitle('A &nbsp; B')],
  ['surrogate numeric entity',replaceTitle('A &#xD800;')],
  ['out-of-range numeric entity',replaceTitle('A &#1114112;')],
  ['noncharacter numeric entity',replaceTitle('A &#65534;')],
  ['literal control text',replaceTitle('A \u0001 B')],
  ['literal unpaired surrogate',replaceTitle('A \ud800 B')],
  ['literal control attribute',withAttribute('href="/test.html" bad="\u0001"')],
  ['illegal CDATA character',replaceTitle('<![CDATA[A \u0000 B]]>')],
  ['unclosed CDATA boundary',replaceTitle('<![CDATA[A ]]> B <![CDATA[C')],
  ['CDATA closing outside section',replaceTitle('<![CDATA[A]]> B ]]>')],
  ['CDATA outside root','<![CDATA[x]]>'+rssFixture],
  ['malformed comment',rssFixture.replace('<item>','<!--bad--comment--><item>')],
  ['comment ending dash',rssFixture.replace('<item>','<!--bad---><item>')],
  ['malformed prolog','<?xml version=1.0?>'+rssFixture],
  ['duplicate prolog','<?xml version="1.0"?><?xml version="1.0"?>'+rssFixture],
  ['processing instruction',rssFixture.replace('<item>','<?xml-stylesheet href="x"?><item>')],
  ['unknown namespace declaration',withRoot('<rss version="2.0" xmlns:evil="urn:unreviewed">')],
  ['known prefix wrong URI',withRoot('<rss version="2.0" xmlns:dc="urn:unreviewed">')],
  ['known URI unreviewed prefix',withRoot('<rss version="2.0" xmlns:evil="http://purl.org/dc/elements/1.1/">')],
  ['wrong prefix URI pair',withRoot('<rss version="2.0" xmlns:d="http://www.w3.org/2005/Atom">')],
  ['unknown default namespace',withRoot('<rss version="2.0" xmlns="urn:unreviewed">')],
  ['unknown namespace injection',rssFixture.replace('<description>','<description xmlns:evil="urn:unreviewed">')],
  ['namespace shadowing',atom.replace('<entry>','<entry xmlns:d="http://www.w3.org/2005/Atom">')],
  ['default namespace shadowing',atom.replace('<entry>','<entry xmlns="http://purl.org/rss/1.0/">')],
  ['default namespace undeclaration',atom.replace('<entry>','<entry xmlns="">')],
  ['reserved xml rebinding',withRoot('<rss version="2.0" xmlns:xml="urn:unreviewed">')],
  ['reserved xmlns binding',withRoot('<rss version="2.0" xmlns:xmlns="http://www.w3.org/2000/xmlns/">')],
  ['review evil item','<rss version="2.0" xmlns:evil="urn:unreviewed"><channel><evil:item><evil:title>Foreign field</evil:title><evil:link>https://www.pref.kagoshima.jp/test.html</evil:link><evil:date>2026-10-06</evil:date></evil:item></channel></rss>'],
  ['review RSS missing channel',rssFixture.replace('<channel>','').replace('</channel>','')],
  ['RSS duplicate channel',rssFixture.replace('</rss>','<channel/></rss>')],
  ['RSS entry in channel',rssFixture.replaceAll('item>','entry>')],
  ['RSS wrapper around item',rssFixture.replace('<item>','<wrapper><item>').replace('</item>','</item></wrapper>')],
  ['RSS channel nested in wrapper',rssFixture.replace('<channel>','<wrapper><channel>').replace('</channel>','</channel></wrapper>')],
  ['RSS RDF namespace item',withRoot('<rss version="2.0" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">').replaceAll('item>','rdf:item>')],
  ['RSS unknown field',rssFixture.replace('</item>','<unknown>ignored</unknown></item>')],
  ['RSS channel-only field in item',rssFixture.replace('</item>','<lastBuildDate>Tue, 06 Oct 2026 12:00:00 GMT</lastBuildDate></item>')],
  ['RSS Atom field in item',rssFixture.replace('</item>','<summary>unreviewed</summary></item>')],
  ['RSS item-only field in channel',rssFixture.replace('<channel>','<channel><guid>channel-id</guid>')],
  ['RSS container text',rssFixture.replace('<channel>','<channel>unreviewed text')],
  ['Atom wrong root namespace',atom.replace('xmlns="http://www.w3.org/2005/Atom"','xmlns="http://purl.org/rss/1.0/"')],
  ['Atom entry wrapper',atom.replace('<entry>','<wrapper><entry>').replace('</entry>','</entry></wrapper>')],
  ['Atom channel entry',atom.replace('<entry>','<channel><entry>').replace('</entry>','</entry></channel>')],
  ['Atom RSS item',atom.replaceAll('entry>','item>')],
  ['Atom DC entry',atom.replaceAll('entry>','d:entry>')],
  ['Atom RSS field in entry',atom.replace('</entry>','<description>unreviewed</description></entry>')],
  ['Atom entry-only field at root',atom.replace('<entry>','<summary>unreviewed</summary><entry>')],
  ['Atom wrong field namespace',atom.replaceAll('title>','d:title>')],
  ['Atom field nested entry',atom.replace('<summary>','<summary><entry/>')],
  ['RDF missing channel',rdf.replace(/<channel[\s\S]*?<\/channel>/,'')],
  ['RDF duplicate channel',rdf.replace('</rdf:RDF>','<channel/></rdf:RDF>')],
  ['RDF item inside channel',rdf.replace('</channel>','').replace('</rdf:RDF>','</channel></rdf:RDF>')],
  ['RDF item wrapper',rdf.replace('<item ','<wrapper><item ').replace('</item>','</item></wrapper>')],
  ['RDF Atom entry',rdf.replace('<item rdf:about="urn:fixture:1">','<entry>').replace('</item>','</entry>')],
  ['RDF root wrong expanded name',rdf.replaceAll('rdf:RDF','RDF')],
  ['RDF invalid sequence child',rdf.replace('rdf:li','rdf:item')],
  ['RDF sequence in wrong location',rdf.replace('<items>','').replace('</items>','')],
  ['RDF RSS2 field in item',rdf.replace('</item>','<guid>unreviewed</guid></item>')],
  ['RDF unknown structure after valid item',rdf.replace('</rdf:RDF>','<rdf:Seq/></rdf:RDF>')],
  ['RDF sequence missing resource',rdf.replace('rdf:resource="https://www.pref.kagoshima.jp/test.html"','')],
  ['RDF sequence literal text',rdf.replace('<rdf:Seq>','<rdf:Seq>unreviewed')],
  ['node bound','<rss version="2.0"><channel>'+ '<title/>'.repeat(4097)+'</channel></rss>'],
  ['depth bound','<rss version="2.0"><channel>'+ '<description>'.repeat(17)+'</description>'.repeat(17)+'</channel></rss>'],
  ['tag byte bound',withAttribute('href="/test.html" extra="'+'x'.repeat(4096)+'"')],
  ['field output bound',replaceTitle('x'.repeat(1025))],
  ['metadata field bound',rssFixture.replace('Short metadata','x'.repeat(4097))],
  ['late invalid structure',rssFixture.replace('</channel>','<wrapper><item/></wrapper></channel>')]
];
for (const [name,body] of invalidXml) test(`XML fail closed through capture: ${name}`,async()=>{
  assert.throws(()=>feedRecords(body,rss));
  const state=emptyState(),cursor=new Date(now-7200000).toISOString(); state.sourceCursors[rss.id]=cursor;
  const r=await capture(config,{state,seenState:'ok',imported:null,failures:[]},fixtureFetcher({[rss.endpoint]:body}));
  const health=r.sourceHealth.find(x=>x.sourceId===rss.id);
  assert.equal(health.status,'error'); assert.equal(health.itemCount,0);
  assert.equal(r.observations.filter(x=>x.sourceId===rss.id).length,0);
  assert.equal(r.state.sourceCursors[rss.id],cursor);
  assert.ok(r.state.seen.every(x=>!x.identifierKey.includes(rss.id)));
});
test('XML valid escaped attributes, quoted greater-than and CDATA boundaries preserve metadata',()=>{
  const body=withAttribute('href="/test&amp;name.html" note="A > B &lt; C &#x65E5;"').replace('A &amp; B','<![CDATA[A & B]]>&#32;&#x65E5;&lt;&gt;&quot;&apos;');
  const row=feedRecords(body,rss)[0]; assert.equal(row.canonicalUrl,'https://www.pref.kagoshima.jp/test&name.html'); assert.equal(row.title,'A & B 日<>"\'');
});
test('reviewed namespaced Atom and existing Kagoshima RDF metadata remain valid',()=>{
  const prefixed=atom.replace('<feed xmlns="http://www.w3.org/2005/Atom"','<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"').replace('</feed>','</atom:feed>').replaceAll('<entry>','<atom:entry>').replaceAll('</entry>','</atom:entry>').replaceAll('<title>','<atom:title>').replaceAll('</title>','</atom:title>').replaceAll('<summary>','<atom:summary>').replaceAll('</summary>','</atom:summary>');
  assert.deepEqual(feedRecords(prefixed,rss),feedRecords(atom,rss));
  const metadata=rdf.replace('<item rdf:about="urn:fixture:1">','<item rdf:about="urn:fixture:1"><dc:creator>Department</dc:creator><dc:subject>Local</dc:subject><dc:publisher>Prefecture</dc:publisher><dc:contributor>Department</dc:contributor>');
  assert.deepEqual(feedRecords('<?xml version="1.0" encoding="utf-8" ?>'+metadata,rss),feedRecords(rdf,rss));
});
test('minimal HN deleted/dead items classify after object and positive expected-id binding',()=>{
  assert.equal(hnRecord({id:123,deleted:true},123).status,'deleted'); assert.equal(hnRecord({id:123,dead:true},123).status,'dead');
  for (const bad of [{id:124,deleted:true},{id:0,deleted:true},{id:'123',deleted:true},{id:123,deleted:'true'},{id:123,deleted:false}]) assert.throws(()=>hnRecord(bad,123));
});
test('minimal HN deleted item reaches capture classification without an Observation',async()=>{
  const r=await capture(config,recoverState({},compatibility,now),fixtureFetcher({[hn.endpoint]:'[123]','https://hacker-news.firebaseio.com/v0/item/123.json':'{"id":123,"deleted":true}'}));
  assert.equal(r.sourceHealth[0].status,'empty'); assert.deepEqual(r.sourceHealth[0].classifications,{deleted:1}); assert.equal(r.sourceHealth[0].itemCount,0); assert.ok(!r.observations.some(x=>x.sourceId===hn.id));
});
test('HTML index uses reviewed item surface, ignoring navigation changes',()=>{
  const a=htmlRecords(htmlFixture,html)[0],b=htmlRecords(htmlFixture.replace('<body>','<body><nav>new navigation</nav>'),html)[0];
  assert.equal(digest(a.semantic),digest(b.semantic)); assert.equal(a.published,'2026-10-06'); assert.equal(a.precision,'date');
  assert.notEqual(digest(a.semantic),digest(htmlRecords(htmlFixture.replace('Fixture','Different'),html)[0].semantic));
});
for (const [name,body] of [['selector drift',htmlFixture.replaceAll('PublicationList','Other')],['no items','<html><body></body></html>'],['malformed body',htmlFixture.replace('</body>','')],['missing title',htmlFixture.replace('</span>','')],['cross host',htmlFixture.replace('/news/test-story','https://evil.invalid/news/test-story')],['query',htmlFixture.replace('/news/test-story','/news/test-story?secret=1')],['invalid date',htmlFixture.replace('Oct 6','Feb 30')]]) test(`HTML fails closed: ${name}`,()=>assert.throws(()=>htmlRecords(body,html)));
for (const ip of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','192.0.0.8','100.64.0.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2001:2::1','2002:0808:0808::','3fff::1']) test(`reserved address rejected: ${ip}`,()=>assert.equal(publicAddress(ip),false));
test('public unicast addresses are accepted and fixed families exclude arbitrary links',()=>{
  assert.ok(publicAddress('8.8.8.8')); assert.ok(publicAddress('2606:4700:4700::1111'));
  assert.ok(endpointAllowed(hn.endpoint,hn)); assert.ok(endpointAllowed('https://hacker-news.firebaseio.com/v0/item/123.json',hn));
  for (const u of ['http://hacker-news.firebaseio.com/v0/newstories.json','https://hacker-news.firebaseio.com/v0/newstories.json?token=s','https://user:secret@hacker-news.firebaseio.com/v0/newstories.json','https://hacker-news.firebaseio.com/v0/not-reviewed.json','https://evil.invalid/v0/newstories.json']) assert.equal(endpointAllowed(u,hn),false);
  assert.equal(endpointAllowed('https://evil.invalid/news',{...html,endpoint:'https://evil.invalid/news'}),false);
});
const response = (body='[]',headers={'content-type':'application/json'},status=200) => ({body:Buffer.from(body),headers,status});
test('resolver results are validated and passed to the request transport; no source credentials',async()=>{
  let called=0; const f=createSourceFetcher({resolver:async()=>[{address:'8.8.8.8',family:4}],transport:async (u,o)=>{called++;assert.deepEqual(o.addresses,[{address:'8.8.8.8',family:4}]); assert.ok(!Object.keys(o.headers).some(k=>/authorization|cookie/i.test(k))); return response();},clock:()=>new Date(at)});
  const r=await f.fetchBody(hn.endpoint,hn); assert.equal(r.capturedAt,at); assert.equal(called,1);
  const blocked=createSourceFetcher({resolver:async()=>[{address:'127.0.0.1',family:4}],transport:async()=>{assert.fail('private resolver must stop before request');}}); await assert.rejects(()=>blocked.fetchBody(hn.endpoint,hn),/dns-policy/);
});
for (const [name,r] of [['oversized',response('x'.repeat(262145))],['content type',response('[]',{'content-type':'text/plain'})],['bad status',response('[]',{},403)],['cross-host redirect',response('',{location:'https://evil.invalid/'},302)],['non-HTTPS redirect',response('',{location:'http://hacker-news.firebaseio.com/v0/newstories.json'},302)],['unexpected path redirect',response('',{location:'/v0/other.json'},302)],['compression',response('[]',{'content-type':'application/json','content-encoding':'gzip'})],['invalid UTF8',{body:Buffer.from([255]),headers:{'content-type':'application/json'},status:200}]]) test(`transport rejects ${name}`,async()=>{
  const f=createSourceFetcher({resolver:async()=>[{address:'8.8.8.8',family:4}],transport:async()=>r}); await assert.rejects(()=>f.fetchBody(hn.endpoint,hn));
});
test('manual redirects re-resolve and pin each request, with bounded hop count',async()=>{
  let resolves=0,requests=0; const f=createSourceFetcher({resolver:async()=>{resolves++;return [{address:resolves===1?'8.8.8.8':'1.1.1.1',family:4}];},transport:async (u,o)=>{requests++;assert.equal(o.addresses[0].address,requests===1?'8.8.8.8':'1.1.1.1');return requests===1?response('',{location:'/v0/item/123.json'},302):response('{}');}});
  await f.fetchBody(hn.endpoint,hn); assert.equal(resolves,2);
  const loop=createSourceFetcher({resolver:async()=>[{address:'8.8.8.8',family:4}],transport:async()=>response('',{location:hn.endpoint},302)}); await assert.rejects(()=>loop.fetchBody(hn.endpoint,hn),/redirect/); assert.equal(loop.stats.requests,3);
  let calls=0; const rebound=createSourceFetcher({resolver:async()=>[{address:++calls===1?'8.8.8.8':'127.0.0.1',family:4}],transport:async()=>response('',{location:hn.endpoint},302)}); await assert.rejects(()=>rebound.fetchBody(hn.endpoint,hn),/dns-policy/); assert.equal(rebound.stats.requests,1);
});
test('seen state counts unique Observations rather than polls, copies forward and compacts the 90d window',()=>{
  const s=emptyState(); assert.equal(updateSeen(s,[obs()],now).newObservationCount,1); const first=s.seen[0];
  assert.equal(updateSeen(s,[obs(123,'Fixture title',later)],now).duplicateObservationCount,1); assert.equal(s.seen[0].uniqueObservationCount90d,1); assert.equal(s.seen[0].firstSeenAt90d,at); assert.equal(s.seen[0].lastSeenAt,later);
  updateSeen(s,[obs(123,'Changed',later)],now); assert.equal(s.seen[0].uniqueObservationCount90d,2); assert.equal(s.seen[0].firstObservationId90d,first.firstObservationId90d); validateState(s,now);
  compactState(s,now+91*86400000); assert.equal(s.seen.length,0); assert.deepEqual(s.observations,{});
});
test('cold start, valid rolling import, invalid rolling checkpoint recovery and no-valid cold-start are bounded',()=>{
  assert.equal(recoverState({},compatibility,now).seenState,'cold-start');
  const good=candidate(); assert.equal(recoverState({rolling:good},compatibility,now).seenState,'ok');
  const bad=candidate(); bad.stateBytes=Buffer.from('corrupt'); const fallback=recoverState({rolling:bad,checkpoint:candidate('checkpoint',9)},compatibility,now); assert.equal(fallback.seenState,'recovered-gap'); assert.equal(fallback.failures.length,1);
  assert.equal(recoverState({rolling:bad,checkpoint:{...bad,kind:'checkpoint'}},compatibility,now).seenState,'cold-start');
  assert.equal(recoverState({rolling:{...good,downloadFailed:true}},compatibility,now).failures[0].code,'download-failed');
});
for (const [name,mutate] of [
  ['attempt',c=>c.run.run_attempt++],['run id',c=>c.run.id++],['head SHA',c=>c.run.head_sha='b'.repeat(40)],['branch',c=>c.run.head_branch='feature'],['repository',c=>c.run.repository.full_name='other/repo'],['workflow',c=>c.run.path='.github/workflows/other.yml'],['failed run',c=>c.run.conclusion='failure'],['incomplete run',c=>c.run.status='in_progress'],['manifest digest',c=>c.manifest.health='ok'],['state digest',c=>{c.manifest.stateDigest=digest('wrong');resign(c);}],['payload digest',c=>{c.manifest.payloadDigest=digest('wrong');resign(c);}],['contract digest',c=>{c.manifest.contractDigest=digest('wrong');resign(c);}],['source config digest',c=>{c.manifest.sourceConfigDigest=digest('wrong');resign(c);}],['unknown manifest field',c=>{c.manifest.rawBody='forbidden';resign(c);}]
]) test(`prior import rejects ${name}`,()=>{const c=candidate();mutate(c);assert.throws(()=>validateCandidate(c.manifest,c.stateBytes,c,compatibility,now));});
test('main advancing alone does not invalidate compatible state; checkpoint can be 89 days old',()=>{
  const c=candidate('checkpoint'); c.run.created_at=isoOld();c.manifest.startedAt=c.run.created_at;c.manifest.completedAt=c.run.created_at;resign(c);
  assert.equal(recoverState({checkpoint:c},compatibility,now).seenState,'recovered-gap'); assert.equal(c.run.head_sha,'a'.repeat(40));
  // The consumer's current SHA is intentionally not a compatibility key.
  const report=packageCapture(resultFixture(),{state:emptyState(),imported:null,seenState:'cold-start',failures:[]},{existingCheckpoint:false},{...run(20,{head_sha:'b'.repeat(40)}),startedAt:at,completedAt:later,sourceRequests:0,responseBytes:0},compatibility,90).report;
  assert.equal(report.run.headSha,'b'.repeat(40));
});
const isoOld=()=>new Date(now-89*86400000).toISOString();
function fixtureFetcher(bodies={}) {
  const calls=[],stats={requests:0,bytes:0};
  return {calls,stats,clock:()=>new Date(later),fetchBody:async (url,source)=>{calls.push(url);stats.requests++;const body=bodies[url] ?? (url===hn.endpoint?'[123]':url.includes('/item/')?JSON.stringify(item()):url===rss.endpoint?rssFixture:htmlFixture);if(body instanceof Error)throw body;stats.bytes+=Buffer.byteLength(body);return {body,capturedAt:at,finalUrl:url};}};
}
test('capture keeps discovered URLs unfetched, discarded semantic text out of artifacts, and source clocks ordered',async()=>{
  const f=fixtureFetcher(),recovery=recoverState({},compatibility,now),r=await capture(config,recovery,f);
  assert.equal(r.observations.length,3); assert.equal(f.calls.length,4); assert.ok(f.calls.every(u=>!u.includes('untrusted'))); assert.deepEqual(r.perLaneCounts,{watch:1,discover:1,sentinel:1});
  const out=packageCapture(r,recovery,{existingCheckpoint:false,apiRequests:2},{...run(20),startedAt:at,completedAt:later,sourceRequests:f.stats.requests,responseBytes:f.stats.bytes},compatibility,30);
  const all=Object.values(out.rolling).map(v=>Buffer.isBuffer(v)?brotliDecompressSync(v).toString('utf8'):v).join(''); assert.ok(!all.includes('ephemeral text')); assert.ok(!all.includes('<html>')); assert.ok(!all.includes('<rdf:RDF')); assert.equal(out.report.publicationAuthorized,false); assert.equal(out.report.retentionCapability,'degraded'); assert.equal(out.report.checkpoint.retentionDays,30);
  assert.equal(out.report.artifactBytes.rolling,Object.values(out.rolling).reduce((sum,x)=>sum+Buffer.byteLength(x),0)); assert.equal(out.report.artifactBytes.checkpoint,Object.values(out.checkpoint).reduce((sum,x)=>sum+Buffer.byteLength(x),0));
});
test('due/skipped/empty/error metrics remain separate and failures never grant publication',async()=>{
  const s=emptyState();s.sourceCursors[html.id]=at; const recovery={state:s,seenState:'ok',imported:null,failures:[]}; const f=fixtureFetcher({[hn.endpoint]:'[]',[rss.endpoint]:new Error('xml-malformed')}); const r=await capture(config,recovery,f);
  assert.deepEqual(r.sourceHealth.map(x=>x.status),['empty','error','skipped-not-due']); assert.equal(r.newObservationCount,0); assert.equal(r.publicationAuthorized,false); assert.equal(r.sourceHealth[2].requests,0);
});
test('unverified HTTP item yields needs-review without fetch, while confirmed HTTPS items are retained',async()=>{
  const f=fixtureFetcher({[rss.endpoint]:rssFixture.replace('</channel>','<item><title>Unreviewed</title><link>http://www.pref.kagoshima.jp/unverified.html</link></item></channel>')}); const r=await capture(config,recoverState({},compatibility,now),f);
  const h=r.sourceHealth.find(x=>x.sourceId===rss.id); assert.equal(h.status,'error');assert.equal(h.classifications['needs-review'],1);assert.equal(h.itemCount,1);assert.ok(f.calls.every(u=>!u.includes('unverified')));
});
for (const [name,body] of [['malformed','{'],['oversized count',JSON.stringify(Array.from({length:1001},(_,i)=>i+1))],['wrong shape','{}'],['invalid id','[0]'],['duplicate id','[123,123]']]) test(`HN list fails closed: ${name}`,async()=>{const f=fixtureFetcher({[hn.endpoint]:body}); const r=await capture(config,recoverState({},compatibility,now),f);assert.equal(r.sourceHealth[0].status,'error');assert.ok(!f.calls.some(u=>u.includes('/item/')));});
function resultFixture(){return {state:emptyState(),observations:[],sourceHealth:[],newObservationCount:0,duplicateObservationCount:0,newlySeenIdentifiers:[],perLaneCounts:{watch:0,discover:0,sentinel:0}};}
test('artifact hard budgets use local bytes and checkpoint contains compact state only',()=>{
  assert.equal(payloadBytes({a:Buffer.alloc(ROLLING_BUDGET)},ROLLING_BUDGET),ROLLING_BUDGET); assert.throws(()=>payloadBytes({a:Buffer.alloc(ROLLING_BUDGET+1)},ROLLING_BUDGET),/budget/);
  assert.throws(()=>payloadBytes({a:Buffer.alloc(CHECKPOINT_BUDGET+1)},CHECKPOINT_BUDGET),/budget/);
  const out=packageCapture(resultFixture(),{imported:null,seenState:'cold-start',failures:[]},{existingCheckpoint:true},{...run(),startedAt:at,completedAt:later,sourceRequests:0,responseBytes:0},compatibility,90);assert.deepEqual(Object.keys(out.checkpoint),['manifest.json','state/seen.json.br']);assert.equal(out.report.checkpoint.uploadPlanned,false);
});
const artifact = (kind,id,attempt=1,date='2026-10-06',created=at) => ({id:id+100,expired:false,created_at:created,workflow_run:{id},name:kind==='rolling'?`radar-shadow-${id}-${attempt}`:`radar-daily-checkpoint-${date}-${id}-${attempt}`});
test('Actions selection checks successful provenance and deterministically selects only two download candidates',async()=>{
  const current=run(20,{created_at:'2026-10-06T13:17:00Z'}),prior=run(10),checkpointRun=run(9);
  const queried=[]; const api=async route=>{queried.push(route);if(route.includes('/workflows/'))return {workflow_runs:[current,prior]};if(route.includes('/10/artifacts'))return {total_count:1,artifacts:[artifact('rolling',10)]};if(route.startsWith('/actions/artifacts'))return {artifacts:[artifact('checkpoint',9),artifact('checkpoint',8,1,'2026-10-05')]};if(route==='/actions/runs/9')return checkpointRun;throw Error(route);};
  const p=await planRecovery(api,current);assert.equal(p.rolling.runId,'10');assert.equal(p.checkpoint.runId,'9');assert.equal(p.existingCheckpoint,true);assert.ok(!queried.includes('/actions/runs/8'));
});
test('latest successful rolling missing does not search older rolling; failed checkpoints cannot suppress upload',async()=>{
  const current=run(20,{created_at:'2026-10-06T13:17:00Z'});
  const api=async route=>route.includes('/workflows/')?{workflow_runs:[run(10),run(8)]}:route.includes('/10/artifacts')?{artifacts:[],total_count:0}:route.startsWith('/actions/artifacts')?{artifacts:[artifact('checkpoint',9),artifact('checkpoint',7,1,'2026-10-05')]}:route.endsWith('/9')?run(9,{conclusion:'failure'}):run(7,{created_at:'2026-10-05T12:17:00Z'});
  const p=await planRecovery(api,current);assert.equal(p.rolling,null);assert.equal(p.checkpoint.runId,'7');assert.equal(p.existingCheckpoint,false);
});
test('Actions API absence, pagination bound and foreign workflow provenance fail closed',async()=>{
  await assert.rejects(()=>planRecovery(async()=>({}),run(20)),/unavailable/);
  await assert.rejects(()=>planRecovery(async route=>route.includes('/workflows/')?{workflow_runs:[run(10,{path:'other'})]}:{artifacts:[]},run(20,{created_at:later})),/provenance/);
  await assert.rejects(()=>planRecovery(async route=>route.includes('/workflows/')?{workflow_runs:[]}:{artifacts:Array.from({length:100},()=>({name:'unrelated',created_at:at}))},run(20),{maxPages:2}),/scan-bound/);
});
test('JST checkpoint dates and schedule delay method are explicit',()=>{
  assert.equal(jstDate('2026-10-06T15:00:00Z'),'2026-10-07');assert.equal(scheduledSlot('2026-10-06T13:05:00Z','schedule'),'2026-10-06T12:17:00.000Z');assert.equal(scheduledSlot(at,'workflow_dispatch'),null);
});
test('contract forbids publication authorization and unknown event/raw-body fields',()=>{
  const out=packageCapture(resultFixture(),{imported:null,seenState:'cold-start',failures:[]},{existingCheckpoint:false},{...run(),startedAt:at,completedAt:later,sourceRequests:0,responseBytes:0},compatibility,90);
  assert.throws(()=>validateContract({...out.report,publicationAuthorized:true},'report'));assert.throws(()=>validateContract({...out.report,eventId:'invented'},'report'));assert.throws(()=>validateContract({...obs(),body:'raw'},'observation'));
  const s=emptyState();updateSeen(s,[obs()],now);s.seen[0].uniqueObservationCount90d=10;assert.throws(()=>validateState(s,now),/seen-ledger/);
});
test('workflow uses main-only read permissions, pinned checkout, Node 22, attempt artifacts and runner temp',()=>{
  const w=fs.readFileSync(new URL('../.github/workflows/discovery-radar-shadow.yml',import.meta.url),'utf8');
  for(const pattern of [/cron: '17 \* \* \* \*'/,/contents: read/,/actions: read/,/refs\/heads\/main/,/node-version: '22'/,/timeout-minutes: 10/,/cancel-in-progress: false/,/persist-credentials: false/,/ref: \$\{\{ github.sha \}\}/,/radar-shadow-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/,/runner.temp.*discovery-radar/,/continue-on-error: true/,/if-no-files-found: error/]) assert.match(w,pattern);
  assert.ok(!/contents: write|actions: write|secrets\.|npm install|git push|gh pr|deploy-pages|notification/.test(w));assert.match(w,/github-token: \$\{\{ github.token \}\}/);
});
test('90-day identity-only sampled HN state fits checkpoint locally without dropping in-window observations',()=>{
  const s=emptyState();const end=now;for(let i=0;i<2160;i++){const firstAt=new Date(end-i*3600000).toISOString();const id=digest(`observation-${i}`);s.observations[id]={firstAt,lastAt:firstAt,seenAt:[firstAt],identifiers:[`item:hn-new:${i+1}`,`url:hn-new:https://news.ycombinator.com/item?id=${i+1}`],channelClass:'aggregator'};}s.seen=seenRecords(s);
  const bytes=brotliCompressSync(canonical(s)+'\n',{params:{[constants.BROTLI_PARAM_QUALITY]:5}});assert.ok(bytes.length<CHECKPOINT_BUDGET-16384,`measured ${bytes.length}`);assert.equal(Object.keys(s.observations).length,2160);
});
test('rolling window preserves a repolled Observation and uses its actual earliest in-window capture',()=>{
  const s=emptyState();updateSeen(s,[obs()],now);
  const t=new Date(now+89*86400000).toISOString();updateSeen(s,[obs(123,'Fixture title',t)],Date.parse(t));
  compactState(s,now+91*86400000);assert.equal(s.seen[0].uniqueObservationCount90d,1);assert.equal(s.seen[0].firstSeenAt90d,t);assert.equal(s.seen[0].lastSeenAt,t);
});
test('production HTTPS transport pins lookup in both single and all-address lookup modes',async()=>{
  let lookups=0;
  const request=(_url,options,callback)=>{
    options.lookup('reviewed.invalid',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);lookups++;});
    options.lookup('reviewed.invalid',{all:true},(error,addresses)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);lookups++;});
    assert.equal(options.agent,false);
    const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.headers={'content-type':'application/json'};res.statusCode=200;callback(res);res.emit('data',Buffer.from('[]'));res.emit('end');});return req;
  };
  const r=await pinnedRequest(hn.endpoint,{addresses:[{address:'8.8.8.8',family:4}],maxBytes:10,request});assert.equal(r.bytes,2);assert.equal(lookups,2);
});
test('source configuration cannot expand endpoint families, cadence, item volume or credentials',()=>{
  validateSourceConfig(config);
  for (const mutate of [c=>c.sources.push(c.sources[0]),c=>c.sources[0].maxItems=2,c=>c.sources[1].endpoint='https://evil.invalid/feed',c=>c.sources[2].cadenceSeconds=60,c=>c.sources[2].authorization='secret',c=>c.sources[1].contentTypes.push('application/octet-stream')]) { const c=structuredClone(config);mutate(c);assert.throws(()=>validateSourceConfig(c)); }
});
test('runtime output requires runner temp outside repository and refuses symlink redirection',t=>{
  assert.throws(()=>outputBase({}),/runner-temp/);
  const repositoryRoot=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
  assert.throws(()=>outputBase({RUNNER_TEMP:repositoryRoot}),/repository/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-output-fixture-'));
  const base=path.join(dir,'discovery-radar');fs.symlinkSync(repositoryRoot,base,process.platform==='win32'?'junction':'dir');
  t.after(()=>{fs.unlinkSync(base);assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmdirSync(dir);});
  assert.throws(()=>outputBase({RUNNER_TEMP:dir}),/symlink/);
});
