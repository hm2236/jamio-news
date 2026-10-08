import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TARGETS,USER_AGENT,PRODUCT_TOKEN,DEADLINE_MS,ROBOTS_BUDGET,FEED_BUDGET,WARNING,FAILURE,robotsPolicy,createRequester,probe,expectedBinding,summary} from '../scripts/discovery-radar-feed-probe.mjs';

const env=()=>({GITHUB_REPOSITORY:'hm2236/jamio-news',GITHUB_EVENT_NAME:'pull_request',GITHUB_WORKFLOW:'Discovery Radar official feed probe',GITHUB_WORKFLOW_REF:'hm2236/jamio-news/.github/workflows/discovery-radar-feed-probe.yml@refs/pull/59/merge',GITHUB_REF:'refs/pull/59/merge',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'b'.repeat(40),PROBE_HEAD_SHA:'a'.repeat(40)});
const event=()=>({pull_request:{number:59,head:{sha:'a'.repeat(40),repo:{full_name:'hm2236/jamio-news'}},base:{ref:'main',repo:{full_name:'hm2236/jamio-news'}}}});
const binding=()=>expectedBinding(env(),event(),'a'.repeat(40));
const allowed='User-agent: *\nAllow: /\nDisallow: /other/\n';
const response=(body,status=200,type='text/plain',extra={})=>({status,headers:{'content-type':type,...extra},body:Buffer.isBuffer(body)?body:Buffer.from(body)});
function fixture(responses={},options={}) {
  const calls=[];
  const requester=createRequester({resolver:async()=>[{address:'8.8.8.8',family:4}],transport:async(url,args)=>{calls.push({url,args});const value=responses[url]??response(url.endsWith('robots.txt')?allowed:'<rss>ephemeral title</rss>',200,url.endsWith('robots.txt')?'text/plain':'application/rss+xml');if(value instanceof Error)throw value;return value;},...options});
  return {requester,calls};
}

test('fixed targets are immutable and unsupported destinations never resolve or request',async()=>{
  assert.throws(()=>{TARGETS[0].feedUrl='https://evil.invalid';});const f=fixture();
  for(const url of ['https://evil.invalid','http://openai.com/news/rss.xml','https://openai.com/news/rss.xml?token=secret','https://openai.com/news/other'])await assert.rejects(()=>f.requester.request(url),/feed-probe-implementation/);
  assert.equal(f.calls.length,0);
});
test('probe performs exactly four sequential GETs with fixed UA, identity encoding and pinned public addresses',async()=>{
  const f=fixture(),report=await probe(f.requester,binding());
  assert.deepEqual(f.calls.map(call=>call.url),TARGETS.flatMap(target=>[target.robotsUrl,target.feedUrl]));assert.equal(report.requests,4);
  for(const call of f.calls){assert.deepEqual(call.args.addresses,[{address:'8.8.8.8',family:4}]);assert.equal(call.args.headers['User-Agent'],USER_AGENT);assert.equal(call.args.headers['Accept-Encoding'],'identity');assert.equal(call.args.timeoutMs,DEADLINE_MS);assert.equal(call.args.maxBytes,call.url.endsWith('robots.txt')?ROBOTS_BUDGET:FEED_BUDGET);assert.equal(call.args.headers.Authorization,undefined);}
  assert.ok(report.results.every(result=>result.feed.status==='response-validated'&&result.feed.httpStatus===200&&/^sha256:[a-f0-9]{64}$/.test(result.feed.bodyDigest)));
  await assert.rejects(()=>f.requester.request(TARGETS[0].feedUrl),/feed-probe-implementation/);assert.equal(f.calls.length,4);
});
for(const [name,text,result] of [
  ['wildcard allow',allowed,'robots-allowed'],['empty deny','User-agent: *\nDisallow:\n','robots-allowed'],
  ['literal prefix deny','User-agent: *\nDisallow: /news/\n','robots-disallowed'],
  ['allow cannot override deny','User-agent: *\nDisallow: /news\nAllow: /news/rss.xml\n','robots-disallowed'],
  ['product token deny',`User-agent: *\nAllow: /\nUser-agent: ${PRODUCT_TOKEN}\nDisallow: /news/\n`,'robots-disallowed'],
  ['case-insensitive product',`user-agent: ${PRODUCT_TOKEN.toLowerCase()}\ndisallow: /news/\n`,'robots-disallowed'],
  ['duplicate product groups',`User-agent: ${PRODUCT_TOKEN}\nAllow: /\nUser-agent: ${PRODUCT_TOKEN}\nDisallow: /news\n`,'robots-disallowed'],
  ['unrelated unsupported group',`User-agent: OtherBot\nDisallow: /*\nUser-agent: *\nAllow: /\n`,'robots-allowed'],
  ['global sitemap metadata',`Sitemap: https://evil.invalid/ignored\n${allowed}`,'robots-allowed'],
  ['unknown groups','User-agent: OtherBot\nAllow: /\n','robots-unproven'],
  ['missing rules','User-agent: *\n','robots-unproven'],['missing groups','Disallow: /\n','robots-unproven'],
  ['malformed line','User-agent: *\nmalformed secret text\n','robots-unproven'],
  ['applicable wildcard','User-agent: *\nDisallow: /*\n','robots-unproven'],
  ['applicable end-anchor','User-agent: *\nDisallow: /news/rss.xml$\n','robots-unproven'],
  ['applicable percent encoding','User-agent: *\nDisallow: /%6eews/\n','robots-unproven'],
  ['applicable access directive','User-agent: *\nCrawl-delay: 10\nAllow: /\n','robots-unproven'],
  ['malformed path','User-agent: *\nDisallow: news\n','robots-unproven'],
  ['control character','User-agent: *\nAllow: /\u0000\n','robots-unproven'],
  ['too many lines',allowed+'\n'.repeat(4096),'robots-unproven'],
  ['oversized body',allowed+'#'.repeat(ROBOTS_BUDGET),'robots-unproven']
])test(`robots ${name} is ${result}`,()=>{assert.equal(robotsPolicy(text,'/news/rss.xml').code,result);});
test('robots unknown/disallowed policy skips feed and preserves null feed HTTP status',async()=>{
  for(const text of ['User-agent: *\nDisallow: /\n','User-agent: OtherBot\nAllow: /\n']){
    const f=fixture(Object.fromEntries(TARGETS.map(target=>[target.robotsUrl,response(text)]))),report=await probe(f.requester,binding());
    assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.url.endsWith('/robots.txt')));assert.ok(report.results.every(result=>result.feed.status==='not-requested'&&result.feed.httpStatus===null));
  }
});
for(const [status,code] of [[403,'http-forbidden'],[429,'http-rate-limited'],[500,'http-server-error'],[503,'http-server-error'],[404,'http-status'],[204,'http-status'],[302,'redirect-unproven']])test(`feed HTTP${status} reports ${code} without redirects/retries`,async()=>{
  const f=fixture({[TARGETS[0].feedUrl]:response('secret remote body',status,'application/rss+xml',{location:'https://evil.invalid/secret'})});const report=await probe(f.requester,binding());
  assert.equal(report.results[0].feed.code,code);assert.equal(report.results[0].feed.httpStatus,status);assert.equal(report.results[0].feed.bodyDigest,null);assert.equal(f.calls.length,4);assert.ok(!JSON.stringify(report).includes('secret'));assert.ok(!summary(report).includes('evil.invalid'));
});
test('robots403 is not misrepresented as a feed403 and never requests that feed',async()=>{
  const f=fixture({[TARGETS[0].robotsUrl]:response('secret forbidden body',403)}),report=await probe(f.requester,binding());
  assert.equal(report.results[0].robots.httpStatus,403);assert.equal(report.results[0].robots.code,'http-forbidden');assert.equal(report.results[0].feed.httpStatus,null);assert.equal(report.results[0].feed.status,'not-requested');assert.ok(!f.calls.some(call=>call.url===TARGETS[0].feedUrl));
});
for(const [name,value,code] of [
  ['feed content type',response('<html>secret</html>',200,'text/html'),'content-type'],
  ['feed compression',response('compressed',200,'application/rss+xml',{'content-encoding':'gzip'}),'content-encoding'],
  ['feed invalid UTF8',response(Buffer.from([0xc0,0xaf]),200,'application/rss+xml'),'invalid-utf8'],
  ['feed oversize',response(Buffer.alloc(FEED_BUDGET+1),200,'application/rss+xml'),'response-size'],
  ['transport timeout',new Error('timeout'),'timeout'],['transport failure',new Error('transport-error'),'transport-error'],['transport size',new Error('response-size'),'response-size']
])test(`${name} reports fixed ${code}`,async()=>{
  const f=fixture({[TARGETS[0].feedUrl]:value}),report=await probe(f.requester,binding());assert.equal(report.results[0].feed.code,code);assert.equal(report.results[0].feed.bodyDigest,null);assert.equal(f.calls.length,4);
});
for(const [name,value,code] of [
  ['robots nonplain',response('<html>secret</html>',200,'text/html'),'content-type'],
  ['robots invalid UTF8',response(Buffer.from([0xc0,0xaf])),'invalid-utf8'],
  ['robots oversize',response(Buffer.alloc(ROBOTS_BUDGET+1)),'response-size']
])test(`${name} stops feed with fixed ${code}`,async()=>{
  const f=fixture({[TARGETS[0].robotsUrl]:value}),report=await probe(f.requester,binding());assert.equal(report.results[0].robots.code,code);assert.equal(report.results[0].feed.status,'not-requested');assert.ok(!f.calls.some(call=>call.url===TARGETS[0].feedUrl));
});
for(const addresses of [[],[{address:'127.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],[{address:'8.8.8.8',family:6}],[{address:'::ffff:8.8.8.8',family:6}]])test(`DNS untrusted address set is denied before GET (${JSON.stringify(addresses)})`,async()=>{
  const f=fixture({}, {resolver:async()=>addresses}),report=await probe(f.requester,binding());assert.equal(f.calls.length,0);assert.equal(report.requests,0);assert.ok(report.results.every(result=>result.robots.code==='dns-policy'&&result.feed.httpStatus===null));
});
test('DNS timeout has a bounded deadline and performs no GET',async()=>{
  const f=fixture({}, {resolver:()=>new Promise(()=>{}),dnsTimeoutMs:5}),report=await probe(f.requester,binding());assert.equal(f.calls.length,0);assert.ok(report.results.every(result=>result.robots.code==='dns-timeout'));
});
test('known DNS errors are redacted while unexpected programmer errors fail fixed',async()=>{
  const error=new Error('private DNS details');error.code='ENOTFOUND';const f=fixture({}, {resolver:async()=>{throw error;}}),report=await probe(f.requester,binding());assert.ok(report.results.every(result=>result.robots.code==='dns-error'));assert.ok(!JSON.stringify(report).includes('private'));
  const bad=fixture({}, {resolver:async()=>{throw new TypeError('secret programmer error');}});await assert.rejects(()=>probe(bad.requester,binding()),{message:'feed-probe-implementation'});
});
test('unexpected transport exception and malformed response fail without echo',async()=>{
  for(const value of [new TypeError('private programmer exception'),new TypeError('timeout'),{status:200,headers:{},body:'invalid body type'}]){
    const f=fixture({[TARGETS[0].robotsUrl]:value});await assert.rejects(()=>probe(f.requester,binding()),{message:'feed-probe-implementation'});
  }
});
test('summary/JSON contain fixed metadata only, no raw body/header/title/DNS text or source-generated links',async()=>{
  const f=fixture({[TARGETS[0].feedUrl]:response('<rss><title>PRIVATE TITLE</title><link>https://evil.invalid/private</link></rss>',200,'application/rss+xml',{'x-secret':'PRIVATE HEADER'})}),report=await probe(f.requester,binding());const text=JSON.stringify(report)+summary(report);
  for(const secret of ['PRIVATE TITLE','PRIVATE HEADER','evil.invalid','8.8.8.8'])assert.ok(!text.includes(secret));assert.equal(report.publicationAuthorized,false);assert.equal(report.rawSourceBodyPersistedBytes,0);assert.ok(text.includes('NOT PROVEN'));assert.ok(summary(report).includes('Actions merge-ref SHA: '+'b'.repeat(40)));assert.ok(summary(report).includes('exact checked-out head '+'a'.repeat(40)));
});
for(const [name,mutate] of [
  ['repository',e=>e.GITHUB_REPOSITORY='foreign/repo'],['event',e=>e.GITHUB_EVENT_NAME='push'],['workflow',e=>e.GITHUB_WORKFLOW='Other'],['workflow ref',e=>e.GITHUB_WORKFLOW_REF='foreign'],['ref',e=>e.GITHUB_REF='refs/heads/main'],['run',e=>e.GITHUB_RUN_ID='0'],['run leading zeros',e=>e.GITHUB_RUN_ID='000'],['attempt',e=>e.GITHUB_RUN_ATTEMPT='0'],['merge SHA',e=>e.GITHUB_SHA='bad'],['declared head',e=>e.PROBE_HEAD_SHA='c'.repeat(40)]
])test(`environment ${name} mismatch fails before network`,()=>{const e=env();mutate(e);assert.throws(()=>expectedBinding(e,event(),'a'.repeat(40)),/feed-probe-environment/);});
test('foreign fork, malformed PR, and actual checked-out Git HEAD mismatch fail',()=>{
  const fork=event();fork.pull_request.head.repo.full_name='foreign/fork';assert.throws(()=>expectedBinding(env(),fork,'a'.repeat(40)),/feed-probe-environment/);
  const wrong=event();wrong.pull_request.number=60;assert.throws(()=>expectedBinding(env(),wrong,'a'.repeat(40)),/feed-probe-environment/);
  const nonmain=event();nonmain.pull_request.base.ref='feature';assert.throws(()=>expectedBinding(env(),nonmain,'a'.repeat(40)),/feed-probe-environment/);
  assert.throws(()=>expectedBinding(env(),event(),'b'.repeat(40)),/feed-probe-environment/);
});
test('CLI malformed environment fails fixed and does not print tokens or initiate a probe',()=>{
  const script=fileURLToPath(new URL('../scripts/discovery-radar-feed-probe.mjs',import.meta.url));
  try{execFileSync(process.execPath,[script],{env:{...env(),GITHUB_EVENT_PATH:'',SECRET:'private text'},encoding:'utf8',stdio:'pipe'});assert.fail('expected CLI failure');}catch(error){assert.equal(error.status,1);assert.equal(error.stdout.trim(),FAILURE);assert.equal(error.stderr,'');assert.ok(!error.stdout.includes('private'));}
});
test('workflow is same-repo PR-only, exact-head, four path-filtered, read-only and bounded',()=>{
  const text=fs.readFileSync(new URL('../.github/workflows/discovery-radar-feed-probe.yml',import.meta.url),'utf8');
  assert.ok(text.includes('pull_request:'));assert.ok(text.includes('github.event.pull_request.head.repo.full_name == github.repository'));assert.ok(text.includes('ref: ${{ github.event.pull_request.head.sha }}'));assert.ok(text.includes('persist-credentials: false'));assert.ok(text.includes('contents: read'));assert.ok(text.includes('timeout-minutes: 2'));assert.ok(text.includes("node-version: '22'"));
  for(const prohibited of ['schedule:','workflow_dispatch:','push:','actions: write','GITHUB_TOKEN','secrets.','upload-artifact','deploy'])assert.ok(!text.includes(prohibited));
  assert.ok(text.includes('branches: [main]'));assert.equal((text.match(/^      - (?:scripts|test|docs|\.github)\//gm)||[]).length,4);assert.ok(WARNING.includes('unproven'));assert.equal(USER_AGENT,PRODUCT_TOKEN+'/1.0');
});
test('asynchronous transport requests are sequential, with no overlapping GETs',async()=>{
  let active=0,maximum=0;
  const f=fixture({}, {transport:async url=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return response(url.endsWith('robots.txt')?allowed:'<rss/>',200,url.endsWith('robots.txt')?'text/plain':'application/rss+xml');}});
  const report=await probe(f.requester,binding());assert.equal(maximum,1);assert.equal(report.requests,4);
});
