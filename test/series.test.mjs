import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadRepository, serialize, editionDigest, canonical} from '../scripts/production.mjs';
import {readSeries, validateSeries, assertSeriesTransition, seriesViews, seriesManifest, registryDigest} from '../scripts/series.mjs';
import {seriesMetadata, seriesHeading, seriesNavigation, seriesList, seriesIndex, registryMetadata} from '../scripts/series-html.mjs';
import {assertSeriesManifest, assertSeriesHTML, assertRemoteSeriesPublication, verifySeriesDeployment} from '../scripts/series-proof.mjs';
import {guardPaths} from '../scripts/daily-pr.mjs';
import {checkSeriesChange} from '../scripts/check-series-change.mjs';

const sourceRoot = fileURLToPath(new URL('../',import.meta.url));
const commit = 'a'.repeat(40);
const config = JSON.parse(fs.readFileSync(path.join(sourceRoot,'site.config.json'),'utf8'));
// All campaign/Day content is synthetic and exists only in test repositories.
function fixture() {
  const articles=[], editions=[];
  for (const [slug,clock,count] of [['2026-10-06-morning','07:00',5],['2026-10-06-evening','17:00',1],['2026-10-07-evening','17:00',1]]) {
    const selected=Array.from({length:count},(_,i)=>({slug:`${slug}-fixture-${i}`, title:`仮想ニュース ${slug} ${i} 長いタイトルの折り返しを検証`, summary:'Synthetic fixture only', category:'ai',tags:['fixture'],kind:'news',status:'verified',published:`${slug.slice(0,10)}T${clock}:00+09:00`,verificationNote:'Synthetic source for tests',sources:[{type:'official',title:'Fixture source',url:`https://fixture-source.example.jp/${slug}/${i}`,checked:`${slug.slice(0,10)}T06:00:00+09:00`}],body:'\n## 仮想の本文\n\nFixture only.\n'}));
    const slugs=selected.map(a=>a.slug);
    articles.push(...selected);
    editions.push({slug,date:slug.slice(0,10),variant:slug.split('-').at(-1),priceKeys:[],title:'Fixture edition',kind:'daily',published:selected[0].published,articles:slugs,top5:slugs,hero:slugs[0],deals:[],production:{contractVersion:1,x:{status:'unavailable',note:'Synthetic fixture; no X access'}},body:'\nFixture edition.\n'});
  }
  const series={version:1,id:'fixture-campaign',title:'仮想28 Days（テスト専用）',canonicalTopic:{key:'fixture-campaign',scope:'Synthetic campaign; no real announcement claims'},entities:[{type:'campaign',key:'fixture-campaign',label:'仮想企画'}],status:'active',expectedCount:28,startedAt:'2026-10-06T06:00:00+09:00',coverage:{mode:'partial',note:'Day 3/4は未掲載という仮想例'},revision:1,updatedAt:'2026-10-07T18:00:00+09:00',changeNote:'Synthetic reviewed registration fixture',members:[articles[0],articles[5],articles[6]].map((a,i)=>({article:a.slug,sequence:i+1,relation:i?'update':'start',updateType:'rollout',eventKey:`fixture:day${[1,2,5][i]}`,milestone:{ordinal:[1,2,5][i],label:`Day ${[1,2,5][i]}`},...(i?{delta:{summary:`前回掲載からの仮想差分 ${i}`}}:{})}))};
  return {repository:{config,articles,editions,prices:[]},registry:[series]};
}
function temporary(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jamio-series-'));
  t.after(()=>{if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir()))throw new Error('Unexpected fixture cleanup');fs.rmSync(root,{recursive:true,force:true});});
  for (const name of ['scripts','contracts','public','docs','site.config.json']) fs.cpSync(path.join(sourceRoot,name),path.join(root,name),{recursive:true});
  for (const folder of ['content/articles','content/editions','data/series']) fs.mkdirSync(path.join(root,folder),{recursive:true});
  return root;
}
function save(root,f) {
  for (const a of f.repository.articles) fs.writeFileSync(path.join(root,`content/articles/${a.slug}.md`),serialize(a));
  for (const e of f.repository.editions) fs.writeFileSync(path.join(root,`content/editions/${e.slug}.md`),serialize(e));
  fs.writeFileSync(path.join(root,'data/prices.json'),'[]\n');
  for (const s of f.registry) fs.writeFileSync(path.join(root,`data/series/${s.id}.json`),JSON.stringify(s,null,2)+'\n');
}
const build = root => execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env:{...process.env,GITHUB_SHA:commit},stdio:'pipe'});
const htmlAt = (root,url) => fs.readFileSync(path.join(root,'dist',new URL(url).pathname.slice(new URL(config.url).pathname.length),'index.html'),'utf8');

test('series unset retains repository objects and empty-registry navigation',()=>{
  const f=fixture(), before=canonical(f.repository);
  assert.deepEqual(validateSeries([],f.repository),[]);
  assert.deepEqual(seriesViews([],f.repository),[]);
  assert.equal(canonical(f.repository),before);
});
test('Day 1/2/5 milestones allow continuous 1/2/3 sequence and same-day morning/evening',()=>{
  const f=fixture();assert.doesNotThrow(()=>validateSeries(f.registry,f.repository));
  const view=seriesViews(f.registry,f.repository)[0];
  assert.equal(view.members[0].next,view.members[1].url);
  assert.equal(view.members[2].previous,view.members[1].url);
  assert.equal(view.members[0].previous,null);assert.equal(view.members[2].next,null);
});
test('equal timestamps retain explicit reviewed sequence rather than slug sort',()=>{
  const f=fixture(),s=f.registry[0];
  s.members[1].article=f.repository.articles[1].slug;
  s.members[2].article=f.repository.articles[2].slug;
  [s.members[1].article,s.members[2].article]=[s.members[2].article,s.members[1].article];
  assert.doesNotThrow(()=>validateSeries(f.registry,f.repository));
  assert.equal(seriesViews(f.registry,f.repository)[0].members[1].article,f.repository.articles[2].slug);
});
for (const [name,mutate] of [
  ['1/2/4 gap',s=>s.members[2].sequence=4],
  ['duplicate sequence',s=>s.members[2].sequence=2],
  ['unsorted sequence',s=>s.members.reverse()],
  ['duplicate article',s=>s.members[2].article=s.members[1].article],
  ['duplicate eventKey',s=>s.members[2].eventKey=s.members[1].eventKey],
  ['missing article',s=>s.members[2].article='missing'],
  ['wrong version',s=>s.version=2],
  ['wrong type',s=>s.revision='1'],
  ['unsafe integer',s=>s.expectedCount=Number.MAX_SAFE_INTEGER+1],
  ['unknown definition',s=>s.approved=true],
  ['unknown member previous',s=>s.members[1].previous=s.members[0].article],
  ['unknown nested field',s=>s.coverage.extra='x'],
  ['blank string',s=>s.canonicalTopic.scope=' \t\n'],
  ['empty entities',s=>s.entities=[]],
  ['duplicate entity key',s=>s.entities.push({...s.entities[0],label:'another'})],
  ['active endedAt',s=>s.endedAt=s.updatedAt],
  ['completed without endedAt',s=>s.status='completed'],
  ['invalid actual JST date',s=>s.updatedAt='2026-02-30T06:00:00+09:00'],
  ['end before start',s=>s.expectedEndAt='2026-10-05T06:00:00+09:00'],
  ['start delta',s=>s.members[0].delta={summary:'invalid'}],
  ['missing update delta',s=>delete s.members[1].delta],
  ['long Unicode delta',s=>s.members[1].delta.summary='😀'.repeat(161)],
  ['first update',s=>s.members[0].relation='update'],
  ['later start',s=>s.members[1].relation='start'],
  ['expectedCount overrun',s=>s.members[2].milestone.ordinal=29],
  ['parent absent',s=>s.parentSeriesId='missing'],
  ['parent self',s=>s.parentSeriesId=s.id],
  ['correction missing reference',s=>s.members[1].relation='correction'],
  ['future correction reference',s=>{s.members[1].relation='correction';s.members[1].correctsArticle=s.members[2].article;}],
  ['self correction reference',s=>{s.members[1].relation='correction';s.members[1].correctsArticle=s.members[1].article;}],
  ['update correction field',s=>s.members[1].correctsArticle=s.members[0].article],
  ['publication reverses',s=>{[s.members[1].article,s.members[2].article]=[s.members[2].article,s.members[1].article];}]
]) test(`series rejects ${name}`,()=>{const f=fixture();mutate(f.registry[0]);assert.throws(()=>validateSeries(f.registry,f.repository));});

test('160 Unicode code points are accepted even with surrogate pairs',()=>{const f=fixture();f.registry[0].members[1].delta.summary='😀'.repeat(160);assert.doesNotThrow(()=>validateSeries(f.registry,f.repository));});
test('guide and different variant membership are rejected by existing publication contract',()=>{
  for (const mutate of [f=>{f.repository.articles[5].kind='guide';f.repository.articles[5].status='editorial';},f=>{const e=f.repository.editions[1];e.articles=[f.repository.articles[0].slug];e.top5=e.articles;e.hero=e.articles[0];}]){const f=fixture();mutate(f);assert.throws(()=>validateSeries(f.registry,f.repository));}
});
test('unpublished news and duplicate edition membership cannot enter a series',()=>{
  for(const mutate of [f=>f.registry[0].members[2].article='orphan-news',f=>f.repository.editions.push({...f.repository.editions[2],slug:'2026-10-07-noon',variant:'noon'})]){
    const f=fixture();f.repository.articles.push({...f.repository.articles[6],slug:'orphan-news'});mutate(f);assert.throws(()=>validateSeries(f.registry,f.repository));
  }
});
test('one primary per article across registries, parent cycle and correction outside series reject',()=>{
  const f=fixture(),other=structuredClone(f.registry[0]);other.id='second';f.registry.push(other);
  assert.throws(()=>validateSeries(f.registry,f.repository),/primary/);
  other.members=[];other.parentSeriesId='fixture-campaign';f.registry[0].parentSeriesId='second';assert.throws(()=>validateSeries(f.registry,f.repository),/cycle/);
  delete f.registry[0].parentSeriesId;f.registry[0].members[1].relation='correction';f.registry[0].members[1].correctsArticle=f.repository.articles[1].slug;assert.throws(()=>validateSeries(f.registry,f.repository),/earlier/);
});
test('correction to an earlier member is separate from adjacent navigation',()=>{
  const f=fixture(),s=f.registry[0];s.members[2].relation='correction';s.members[2].correctsArticle=s.members[0].article;
  assert.doesNotThrow(()=>validateSeries(f.registry,f.repository));
  const view=seriesViews(f.registry,f.repository)[0];assert.equal(view.members[2].previous,view.members[1].url);
  assert.ok(seriesNavigation(view,view.members[2]).includes('訂正対象:'));
});
test('article and edition clocks are independently nondecreasing',()=>{
  const f=fixture();f.repository.articles[6].published='2026-10-07T06:00:00+09:00';
  f.repository.editions[2].published='2026-10-07T06:30:00+09:00';
  assert.doesNotThrow(()=>validateSeries(f.registry,f.repository));
  // Same-date articles can increase while their owning editions decrease.
  f.registry[0].members=f.registry[0].members.slice(0,2);
  f.repository.articles[0].published='2026-10-06T06:00:00+09:00';
  f.repository.articles[5].published='2026-10-06T06:30:00+09:00';
  f.repository.editions[0].published='2026-10-06T18:00:00+09:00';
  assert.throws(()=>validateSeries(f.registry,f.repository),/order/);
});
test('registry accepts completed lifecycle with real end and rejects filename mismatch and irregular entries',t=>{
  const root=temporary(t),f=fixture(),s=f.registry[0];s.status='completed';s.endedAt=s.updatedAt;
  save(root,f);assert.doesNotThrow(()=>validateSeries(readSeries(root),f.repository));
  fs.renameSync(path.join(root,'data/series/fixture-campaign.json'),path.join(root,'data/series/wrong.json'));assert.throws(()=>readSeries(root),/filename/);
  fs.renameSync(path.join(root,'data/series/wrong.json'),path.join(root,'data/series/fixture-campaign.json'));
  fs.mkdirSync(path.join(root,'data/series/not-json'));assert.throws(()=>readSeries(root),/regular/);
});
test('normal append preserves prefix, definition and active status; maintenance needs explicit new revision',()=>{
  const f=fixture(),base=structuredClone(f.registry);base[0].members.pop();
  assert.doesNotThrow(()=>assertSeriesTransition(base,f.registry,{mode:'append'}));
  for(const mutate of [s=>s.members[0].eventKey='changed',s=>s.title='changed',s=>s.members[2].milestone.ordinal=1]){
    const candidate=structuredClone(f.registry);mutate(candidate[0]);assert.throws(()=>assertSeriesTransition(base,candidate,{mode:'append'}));
  }
  for(const state of ['paused','completed','discontinued']){const before=structuredClone(base),after=structuredClone(f.registry);before[0].status=state;after[0].status=state;assert.throws(()=>assertSeriesTransition(before,after),/inactive/);}
  const changed=structuredClone(f.registry);changed[0].members[0].eventKey='corrected';assert.throws(()=>assertSeriesTransition(f.registry,changed),/revision/);
  changed[0].revision++;changed[0].updatedAt='2026-10-08T06:00:00+09:00';changed[0].changeNote='Human reorganisation review fixture';assert.doesNotThrow(()=>assertSeriesTransition(f.registry,changed));
  assert.throws(()=>assertSeriesTransition(f.registry,[]),/removed/);
  assert.throws(()=>guardPaths('daily/2026-10-08-morning',[{status:'M',file:'data/series/fixture-campaign.json',mode:'100644'}]),/forbidden/);
});
test('append changes only navigation proof, retaining every old edition digest and source object',()=>{
  const f=fixture(),source=canonical(f.repository),before=structuredClone(f.registry);before[0].members.pop();
  const oldDigests=f.repository.editions.map(e=>editionDigest(e,f.repository.articles,[]));
  const old=seriesViews(before,f.repository)[0],next=seriesViews(f.registry,f.repository)[0];
  assert.notEqual(old.navigationDigest,next.navigationDigest);assert.notEqual(registryDigest(before),registryDigest(f.registry));
  assert.equal(old.members[1].next,null);assert.equal(next.members[1].next,next.members[2].url);
  assert.deepEqual(f.repository.editions.map(e=>editionDigest(e,f.repository.articles,[])),oldDigests);assert.equal(canonical(f.repository),source);
});
test('registry proof is canonical, ordered by stable id and portable across LF/CRLF',()=>{
  const f=fixture(),first=structuredClone(f.registry[0]),second=structuredClone(first);second.id='another';second.members=[];
  first.coverage.note='Line one\nLine two';
  const windows=structuredClone(first);windows.coverage.note='Line one\r\nLine two';
  assert.equal(registryDigest([first,second]),registryDigest([second,windows]));
});
test('parent/child titles and links are included in navigation digests without crossing series',()=>{
  const f=fixture(),child=structuredClone(f.registry[0]);child.id='child';child.parentSeriesId=f.registry[0].id;child.members=[{...child.members[0],article:f.repository.articles[1].slug}];f.registry.push(child);
  const views=seriesViews(f.registry,f.repository),parent=views.find(v=>v.series.id==='fixture-campaign');
  assert.ok(seriesList(parent,views).includes('派生シリーズ:'));assert.equal(views.find(v=>v.series.id==='child').members[0].next,null);
  const before=parent.navigationDigest;child.title='Changed child title';assert.notEqual(seriesViews(f.registry,f.repository).find(v=>v.series.id===parent.series.id).navigationDigest,before);
});
test('publication HTML rejects missing or changed previous/list/next links and digest metadata',()=>{
  const f=fixture(),view=seriesViews(f.registry,f.repository)[0],member=view.members[1];
  const html=`<link rel="canonical" href="${member.url}">${seriesMetadata(view)}${seriesHeading(view,member)}${seriesNavigation(view,member)}`;
  assert.doesNotThrow(()=>assertSeriesHTML(html,member.url,view,member));
  for(const changed of [html.replace('rel="prev"','rel="bad"'),html.replace('シリーズ一覧','stale'),html.replace('rel="next"','rel="bad"'),html.replace(view.navigationDigest,'0'.repeat(64)),html+seriesMetadata(view)])assert.throws(()=>assertSeriesHTML(changed,member.url,view,member));
});
test('static fixture build has exact previous/next/list links, safe escaping and native keyboard/320px structure',t=>{
  const root=temporary(t),f=fixture();f.registry[0].title+=' <script> & "';save(root,f);build(root);
  const views=seriesViews(f.registry,f.repository),view=views[0];
  for(const member of view.members){const html=htmlAt(root,member.url);assertSeriesHTML(html,member.url,view,member);assert.ok(html.includes('aria-label="このニュースシリーズ"'));assert.ok(!seriesNavigation(view,member).includes('<script'));assert.ok(!seriesNavigation(view,member).includes('tabindex'));assert.ok(!seriesNavigation(view,member).includes('<button'));}
  const html=htmlAt(root,view.url);assertSeriesHTML(html,view.url,view,null,views);assert.ok(html.includes('Day 5'));assert.ok(html.includes('Day 3/4は未掲載'));
  const css=fs.readFileSync(path.join(root,'dist/assets/style.css'),'utf8');
  assert.match(css,/\.series-links\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:700px\)\{\.series-links\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css,/\.series-links a[^}]*min-height:44px/);assert.match(css,/\.series-links a:focus-visible/);
  assert.ok(html.includes('name="viewport"'));assert.ok(!html.includes('tabindex="-1"'));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'dist/series-publication.json'),'utf8'));assertSeriesManifest(manifest,seriesManifest(f.registry,views,commit,config.url));
});
test('unassigned article HTML, RSS guid/published and edition receipts are identical before/after sidecar',t=>{
  const root=temporary(t),f=fixture();f.registry=[];save(root,f);build(root);
  const url=new URL(`articles/${f.repository.articles[1].slug}/`,config.url),oldHTML=htmlAt(root,url);
  const memberURL=new URL(`articles/${f.repository.articles[0].slug}/`,config.url);assert.ok(!htmlAt(root,memberURL).includes('jamio-series-id'));
  const oldRSS=fs.readFileSync(path.join(root,'dist/rss.xml'),'utf8'),oldPublication=fs.readFileSync(path.join(root,'dist/publication.json'),'utf8');
  f.registry=fixture().registry;save(root,f);build(root);
  assert.equal(htmlAt(root,url),oldHTML);assert.equal(fs.readFileSync(path.join(root,'dist/rss.xml'),'utf8'),oldRSS);assert.equal(fs.readFileSync(path.join(root,'dist/publication.json'),'utf8'),oldPublication);
});
test('series publication requires existing edition proof plus manifest and all current HTML',async t=>{
  const root=temporary(t),f=fixture();save(root,f);build(root);
  let broken=null;
  const request=async url=>{
    const parsed=new URL(url),relative=parsed.pathname.slice(new URL(config.url).pathname.length);
    const file=path.join(root,'dist',relative.endsWith('/')?`${relative}index.html`:relative);
    let body=fs.readFileSync(file,'utf8');
    if(broken==='manifest'&&relative==='series-publication.json')body=body.replace(commit,'b'.repeat(40));
    if(broken==='index'&&relative==='series/')body=body.replace('jamio-series-registry-digest','bad-registry');
    if(broken==='next'&&relative.startsWith(`articles/${f.registry[0].members[0].article}/`))body=body.replace('rel="next"','rel="bad"');
    if(broken==='edition'&&relative.startsWith('editions/'))body=body.replace('jamio-edition-digest','bad-edition');
    return new Response(body,{status:200});
  };
  const receipt=await verifySeriesDeployment(root,commit,{request});assert.equal(receipt.status,'series-receipt-verified');assert.equal(receipt.verifiedURLs.length,5);
  for(const failure of ['manifest','index','next','edition']){broken=failure;await assert.rejects(verifySeriesDeployment(root,commit,{request}));}
  const views=seriesViews(f.registry,f.repository),expected=seriesManifest(f.registry,views,commit,config.url);
  for(const change of [m=>m.registryDigest='0'.repeat(64),m=>m.series[0].revision++,m=>m.series[0].navigationDigest='0'.repeat(64),m=>m.series[0].url=config.url,m=>m.series=[],m=>m.extra=true]){const manifest=structuredClone(expected);change(manifest);assert.throws(()=>assertSeriesManifest(manifest,expected));}
  const editionManifest=JSON.parse(fs.readFileSync(path.join(root,'dist/publication.json'),'utf8'));
  const proof={mainRun:{path:'.github/workflows/pages.yml',event:'push',head_branch:'main',head_sha:commit,status:'completed',conclusion:'success',html_url:'https://github.com/hm2236/jamio-news/actions/runs/1'},editionReceipt:{status:'receipt-verified',...editionManifest,verifiedEdition:editionManifest.editions[0]},receipt,expected,expectedURLs:[...receipt.verifiedURLs]};
  assert.equal(assertRemoteSeriesPublication(proof).status,'series-published');
  for(const mutate of [p=>p.mainRun.head_sha='b'.repeat(40),p=>p.mainRun.conclusion='failure',p=>p.mainRun.event='pull_request',p=>p.receipt.commit='b'.repeat(40),p=>delete p.editionReceipt,p=>p.receipt.verifiedURLs=[],p=>p.receipt.verifiedURLs.pop()]){const p=structuredClone(proof);mutate(p);assert.throws(()=>assertRemoteSeriesPublication(p));}
});
test('empty production registry still publishes and verifies its own index proof',async t=>{
  const root=temporary(t),f=fixture();f.registry=[];save(root,f);build(root);
  const request=async url=>{const p=new URL(url).pathname.slice(new URL(config.url).pathname.length);return new Response(fs.readFileSync(path.join(root,'dist',p.endsWith('/')?p+'index.html':p),'utf8'));};
  const proof=await verifySeriesDeployment(root,commit,{request});assert.deepEqual(proof.series,[]);assert.equal(proof.verifiedURLs.length,1);
});
test('Git maintenance check compares immutable base registry and requires revision for prefix edit',t=>{
  const root=temporary(t),f=fixture();save(root,f);
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
  const saveCommit=()=>{git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','fixture']);return git(['rev-parse','HEAD']);};
  git(['init']);const base=saveCommit();assert.equal(checkSeriesChange(root,base).status,'series-change-valid');
  f.registry[0].members[0].eventKey='changed';save(root,f);assert.throws(()=>checkSeriesChange(root,base),/revision/);
  f.registry[0].revision++;f.registry[0].updatedAt='2026-10-08T06:00:00+09:00';f.registry[0].changeNote='Human reviewed correction';save(root,f);assert.equal(checkSeriesChange(root,base).status,'series-change-valid');
  f.repository.articles[0].body+='\nchanged';save(root,f);assert.throws(()=>checkSeriesChange(root,base),/digest/);
});
