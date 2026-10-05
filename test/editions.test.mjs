import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {editionIdentity, priceKey, newestEdition} from '../scripts/edition.mjs';
import {initDraft, applyDraft, planDraft, serialize, loadRepository, editionDigest, editionURL} from '../scripts/production.mjs';
import {guardPaths, validateDailyChange, guardGitPR} from '../scripts/daily-pr.mjs';
import {validateRemotePR, confirmRemotePublication} from '../scripts/remote-proof.mjs';
import {confirmPublication} from '../scripts/confirm-publication.mjs';
import {verifyDeployment} from '../scripts/verify-deployment.mjs';
import {parse} from '../scripts/content.mjs';

const source=fileURLToPath(new URL('../',import.meta.url)), date='2026-10-05', slug=`${date}-evening`;
const commit='c'.repeat(40), head='b'.repeat(40), base='a'.repeat(40);
const row=(d=date)=>({product:'Synthetic GPU',sku:'fixture',shop:'fixture',condition:'Tax/shipping included',currency:'JPY',total:100000,url:'https://fixture.example.jp/item',observed:`${d}T17:00:00+09:00`,verdict:'wait',reason:'Test only'});
function repository(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jamio-editions-'));
  t.after(()=>{if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir()))throw new Error('Unexpected cleanup path');fs.rmSync(root,{recursive:true,force:true});});
  for(const name of ['content','data','docs','public','scripts','contracts','site.config.json'])fs.cpSync(path.join(source,name),path.join(root,name),{recursive:true});
  // Keep the two legacy compatibility fixtures, and isolate synthetic editions
  // from any real morning/noon/evening content added after this change.
  const keep=new Set();
  for(const name of fs.readdirSync(path.join(root,'content/editions'))){
    const file=path.join(root,'content/editions',name),e=parse(fs.readFileSync(file,'utf8'),name);
    if(['2026-10-04','2026-10-05'].includes(e.slug))e.articles.forEach(s=>keep.add(s));else fs.rmSync(file);
  }
  for(const name of fs.readdirSync(path.join(root,'content/articles'))){const file=path.join(root,'content/articles',name),a=parse(fs.readFileSync(file,'utf8'),name);if(!keep.has(a.slug))fs.rmSync(file);}
  fs.writeFileSync(path.join(root,'data/prices.json'),'[]\n');
  return root;
}
function draft(root,id=slug,published='17:18:00',count=5) {
  const identity=editionIdentity(id), init=initDraft(root,id);
  const articles=Array.from({length:count},(_,i)=>({slug:`${id}-fixture-${i}`,title:`${identity.variant} fixture ${i}`,summary:'Synthetic test only',category:i===0?'vr':'ai',tags:['fixture'],status:'verified',kind:'news',published:`${identity.date}T${published}+09:00`,verificationNote:'Test only',sources:[{title:'Fixture',type:'official',url:'https://fixture.example.jp/',checked:`${identity.date}T07:00:00+09:00`}],body:'\nSynthetic test body.\n'}));
  const refs=articles.map(a=>a.slug);
  const edition={...identity,priceKeys:[],title:`Fixture ${identity.variant}`,kind:'daily',published:`${identity.date}T${published}+09:00`,top5:refs.slice(),hero:refs[0],articles:refs,deals:[],production:{contractVersion:1,x:{status:'unavailable',note:'Test only'}},body:'\nSynthetic edition.\n'};
  const observations=[];
  const save=()=>{fs.writeFileSync(path.join(init.folder,'edition.md'),serialize(edition));for(const a of articles)fs.writeFileSync(path.join(init.folder,'articles',`${a.slug}.md`),serialize(a));fs.writeFileSync(path.join(init.folder,'prices.json'),JSON.stringify(observations));};save();
  return {folder:init.folder,edition,articles,observations,save};
}
const change=file=>({file,status:'A',mode:'100644'});
const changesFor=f=>[...f.articles.map(a=>change(`content/articles/${a.slug}.md`)),change(`content/editions/${f.edition.slug}.md`)];
const addCandidate=(r,f)=>({...r,articles:[...r.articles,...f.articles],editions:[...r.editions,f.edition],prices:[...r.prices,...f.observations]});
test('edition identifiers validate real dates and restrict variant metadata without inferring legacy titles',t=>{
  assert.equal(editionIdentity(date).variant,'legacy');
  for(const id of ['2026-02-30-evening','2026-10-05-night','2026-10-05-evening/other','../2026-10-05','2026-10-05-EVENING'])assert.throws(()=>editionIdentity(id));
  const root=repository(t),f=draft(root);
  for(const mutate of [e=>delete e.date,e=>e.date='2026-10-06',e=>delete e.variant,e=>e.variant='noon',e=>delete e.priceKeys]){const original=structuredClone(f.edition);mutate(f.edition);f.save();assert.throws(()=>planDraft(root,f.folder));Object.assign(f.edition,original);}
});
test('adding evening keeps legacy content, URL and exact golden digests; variant retries and collisions are strict',t=>{
  const root=repository(t),before=loadRepository(root),bytes=fs.readFileSync(path.join(root,`content/editions/${date}.md`));
  const golden={'2026-10-04':'47a5d9b329c39c60dca3571bae28f287740c0e4e4d3964ed1d25394e662709a5','2026-10-05':'0eb0ba7b82acb7ced7f376e7039ba8e4c3e39bda08c534ee916e8b7523f84965'};
  for(const e of before.editions)assert.equal(editionDigest(e,before.articles,before.prices),golden[e.slug]);
  const f=draft(root);assert.equal(applyDraft(root,f.folder).variant,'evening');assert.equal(applyDraft(root,f.folder).status,'unchanged');
  assert.deepEqual(fs.readFileSync(path.join(root,`content/editions/${date}.md`)),bytes);
  const after=loadRepository(root);for(const e of before.editions){assert.equal(editionDigest(e,after.articles,after.prices),golden[e.slug]);assert.equal(editionURL(after.config,e.slug),`https://hm2236.github.io/jamio-news/editions/${e.slug}/`);}
  assert.throws(()=>initDraft(root,slug),/already exists/);
  f.edition.title='Changed';f.save();assert.throws(()=>applyDraft(root,f.folder),/conflict/);
});
test('variant guard accepts fresh evening alongside noon but rejects existing articles, cross-variant paths and code',t=>{
  const root=repository(t),r=loadRepository(root),f=draft(root),changes=changesFor(f),branch=`daily/${slug}`;
  const receipt=validateDailyChange(branch,changes,r,addCandidate(r,f));assert.equal(receipt.date,date);assert.equal(receipt.slug,slug);assert.equal(receipt.variant,'evening');
  for(const file of [`content/editions/${date}.md`,`content/editions/${date}-noon.md`,`content/articles/${date}-old.md`,'scripts/build.mjs','contracts/publishing.schema.json','.github/workflows/pages.yml'])assert.throws(()=>guardPaths(branch,[...changes,change(file)]),/forbidden/);
  const candidate=addCandidate(r,f);candidate.editions.at(-1).articles[0]=r.editions.at(-1).articles[0];assert.throws(()=>validateDailyChange(branch,changes,r,candidate));
  assert.throws(()=>validateDailyChange(branch,changes,addCandidate(r,f),addCandidate(r,f)),/already exists/);
  f.edition.top5=[];assert.throws(()=>validateDailyChange(branch,changes,r,addCandidate(r,f)),/too few|トップニュース/);
});
test('price keys prevent cross-edition digest drift, preserve append-only history, and require exact retries',t=>{
  const root=repository(t),first=draft(root,'2026-10-06-morning','18:00:00');first.observations.push(row('2026-10-06'));first.edition.priceKeys=first.observations.map(priceKey);first.save();applyDraft(root,first.folder);
  const r=loadRepository(root),digest=editionDigest(first.edition,r.articles,r.prices),second=draft(root,'2026-10-06-evening','19:00:00');second.observations.push({...row('2026-10-06'),total:90000,observed:'2026-10-06T18:30:00+09:00'});second.edition.priceKeys=second.observations.map(priceKey);second.save();applyDraft(root,second.folder);
  const after=loadRepository(root);assert.equal(editionDigest(first.edition,after.articles,after.prices),digest);assert.equal(applyDraft(root,first.folder).status,'unchanged');assert.equal(applyDraft(root,second.folder).status,'unchanged');
  const file=path.join(second.folder,'prices.json');fs.writeFileSync(file,'[]');assert.throws(()=>planDraft(root,second.folder),/exactly match/);
  const legacy=draft(root);legacy.observations.push(row());legacy.edition.priceKeys=legacy.observations.map(priceKey);legacy.save();assert.throws(()=>applyDraft(root,legacy.folder),/Existing edition digest/);
  const branch=`daily/${slug}`,changes=[...changesFor(legacy),{file:'data/prices.json',status:'M',mode:'100644'}];assert.throws(()=>validateDailyChange(branch,changes,after,addCandidate(after,legacy)),/Existing edition digest/);
});
test('variant builds select published order and keep both URLs in archive, RSS, search and receipt',t=>{
  const root=repository(t),f=draft(root);applyDraft(root,f.folder);const morning=draft(root,`${date}-morning`,'07:00:00');applyDraft(root,morning.folder);
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env:{...process.env,GITHUB_SHA:commit}});
  const dist=path.join(root,'dist'),read=file=>fs.readFileSync(path.join(dist,file),'utf8');
  const home=read('index.html');assert.ok(home.includes(`href="/jamio-news/editions/${slug}/"`));assert.ok(home.includes(f.articles[0].title));
  for(const id of [date,slug,`${date}-morning`]){assert.ok(fs.existsSync(path.join(dist,`editions/${id}/index.html`)));for(const file of ['archive/index.html','rss.xml','sitemap.xml'])assert.ok(read(file).includes(`/editions/${id}/`));}
  const search=JSON.parse(read('search.json')).find(a=>a.title===f.articles[0].title);assert.equal(search.editions[0].variant,'evening');assert.equal(search.editions[0].url,`/jamio-news/editions/${slug}/`);
  const manifest=JSON.parse(read('publication.json'));const entry=manifest.editions.find(e=>e.slug===slug);assert.equal(entry.date,date);assert.equal(entry.variant,'evening');assert.ok(read(`editions/${slug}/index.html`).includes(entry.digest));assert.equal(manifest.editions[0].slug,slug);
  assert.equal([morning.edition,f.edition].sort(newestEdition)[0].slug,slug);
  assert.match(home,/<h1>最新号<\/h1>/);
  assert.ok(home.includes(`data-edition-panel="${slug}"><div class="issue-heading"`));
  assert.ok(home.includes(`data-edition-panel="${date}-morning" hidden`));
  assert.ok(home.includes(`data-edition-switch="${date}-morning">朝刊</a>`));
  assert.ok(home.includes(`data-edition-switch="${slug}">夕刊</a>`));
  assert.equal((home.match(/id="weather-data"/g)??[]).length,1);
  const important=home.split('<section class="day-news">')[1].split('</section>')[0];
  for(const a of [...morning.articles,...f.articles])assert.ok(important.includes(`/articles/${a.slug}/`));
  const archive=read('archive/index.html');assert.equal((archive.match(/<section class="archive-day">/g)??[]).length,2);
  assert.ok(archive.includes('id="month-2026-10"'));
  assert.ok(read(`editions/${slug}/index.html`).includes('aria-label="前後の号"'));
  const article=read(`articles/${f.articles[0].slug}/index.html`);
  assert.ok(article.includes(`${date} · 夕刊を読む`));
  assert.ok(article.includes(`href="/jamio-news/editions/${slug}/"`));
  const day=archive.split(`datetime="${date}"`)[1].split('</section>')[0];
  for(const id of [date,slug,`${date}-morning`])assert.ok(day.includes(`/editions/${id}/`));
  assert.ok(read(`editions/${slug}/index.html`).includes(`>${date}</time> 夕刊`));
  assert.ok(read(`editions/${date}-morning/index.html`).includes(`>${date}</time> 朝刊`));
  assert.ok(read(`editions/${date}/index.html`).includes('じゃみお昼刊'));
  assert.ok(read(`editions/${date}/index.html`).includes(`>${date}</time> 旧形式号`));
});
test('evenings with 1-5 stories pass local, daily guard, build and exact publication proof',async t=>{
  for(const count of [1,2,3,4,5]){
    const root=repository(t),r=loadRepository(root),f=draft(root,slug,'17:18:00',count);
    const receipt=validateDailyChange(`daily/${slug}`,changesFor(f),r,addCandidate(r,f));
    const applied=applyDraft(root,f.folder);assert.equal(applied.digest,receipt.digest);
    assert.equal(applyDraft(root,f.folder).status,'unchanged');
    execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env:{...process.env,GITHUB_SHA:commit}});
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'dist/publication.json')));
    const html=fs.readFileSync(path.join(root,`dist/editions/${slug}/index.html`),'utf8');
    assert.equal((html.match(/class="number"/g)??[]).length,count);
    assert.equal(manifest.editions[0].digest,receipt.digest);
    const request=async url=>new Response(url.includes('publication.json')?JSON.stringify(manifest):html);
    assert.equal((await verifyDeployment(root,commit,{request})).verifiedEdition.slug,slug);
  }
});
test('empty or oversized evenings and shortened morning, noon or legacy editions fail before writes',t=>{
  for(const [variant,count]of [['evening',0],['evening',6],['morning',4],['noon',4],['legacy',4]]){
    const root=repository(t),id=variant==='legacy'?'2026-10-06':`2026-10-06-${variant}`,f=draft(root,id,'17:18:00',count),r=loadRepository(root);
    assert.throws(()=>planDraft(root,f.folder));
    assert.throws(()=>validateDailyChange(`daily/${id}`,changesFor(f),r,addCandidate(r,f)));
    assert.equal(fs.existsSync(path.join(root,`content/editions/${id}.md`)),false);
  }
});
test('a newer morning with no evening displays only morning and leaves previous evenings in the archive',t=>{
  const root=repository(t),evening=draft(root);applyDraft(root,evening.folder);
  const morning=draft(root,'2026-10-06-morning','07:00:00');applyDraft(root,morning.folder);
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env:{...process.env,GITHUB_SHA:commit}});
  const home=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
  assert.ok(home.includes('2026.10.06 · 朝刊'));
  const switcher=home.split('<nav class="edition-switch"')[1].split('</nav>')[0];
  assert.equal((switcher.match(/data-edition-switch=/g)??[]).length,1);
  assert.ok(home.includes('data-edition-switch="2026-10-06-morning">朝刊</a>'));
  assert.equal(home.includes('夕刊なし'),false);assert.equal(home.includes('今日の重要ニュース'),false);
  assert.equal(home.includes(`data-edition-panel="${slug}"`),false);
});
function proof() {
  const repo={full_name:'hm2236/jamio-news'},identity=editionIdentity(slug),digest='d'.repeat(64),editionUrl=`https://hm2236.github.io/jamio-news/editions/${slug}/`;
  const pr={number:8,state:'open',base:{sha:base,ref:'main',repo},head:{sha:head,ref:`daily/${slug}`,repo}};
  const run=(workflow,event,sha,branch)=>({path:`.github/workflows/${workflow}`,event,head_sha:sha,head_branch:branch,status:'completed',conclusion:'success',html_url:'https://github.com/hm2236/jamio-news/actions/runs/1'});
  const input={pr,expectedHead:head,expectedBase:base,latestMainSha:base,guardRun:{...run('daily-publication.yml','pull_request_target',base,'main'),pull_requests:[{number:8,head:{sha:head},base:{sha:base}}]},guardReceipt:{status:'guard-passed',contractVersion:1,pr:8,baseSha:base,headSha:head,...identity,editionUrl,digest},buildRun:run('pages.yml','pull_request',head,pr.head.ref)};
  const manifest={contractVersion:1,commit,editions:[{date,slug:date,variant:'legacy',url:`https://hm2236.github.io/jamio-news/editions/${date}/`,digest:'e'.repeat(64)},{...identity,url:editionUrl,digest}]};
  const published={validated:validateRemotePR(input),mergeResult:{merged:true,sha:commit},mergedPR:{...pr,merged:true,merge_commit_sha:commit},mainRun:run('pages.yml','push',commit,'main'),manifest,html:`<link rel="canonical" href="${editionUrl}"><meta name="jamio-edition-digest" content="${digest}">`};
  return {input,published};
}
test('remote exact-head proof requires variant identity and cannot confirm an evening from a noon receipt',()=>{
  const f=proof();assert.equal(confirmRemotePublication(f.published).variant,'evening');
  for(const mutate of [r=>delete r.slug,r=>delete r.variant,r=>r.slug=date,r=>r.variant='noon',r=>r.editionUrl=`https://hm2236.github.io/jamio-news/editions/${date}/`]){const p=proof();mutate(p.input.guardReceipt);assert.throws(()=>validateRemotePR(p.input));}
  for(const mutate of [r=>r.editions.pop(),r=>delete r.editions[1].slug,r=>r.editions[1].variant='noon',r=>r.editions.push({...r.editions[1]}),r=>r.commit=head]){const p=proof();mutate(p.published.manifest);assert.throws(()=>confirmRemotePublication(p.published));}
  const p=proof();p.published.deploymentProof={status:'receipt-verified',...p.published.manifest,verifiedEdition:p.published.manifest.editions[1]};delete p.published.manifest;delete p.published.html;assert.equal(confirmRemotePublication(p.published).status,'published');p.published.deploymentProof.verifiedEdition=p.published.deploymentProof.editions[0];assert.throws(()=>confirmRemotePublication(p.published));
});
test('local confirm and deploy verify exact same-date edition receipt and actual HTML',async t=>{
  const root=repository(t),f=draft(root);applyDraft(root,f.folder);execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env:{...process.env,GITHUB_SHA:commit}});
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'dist/publication.json'))),html=fs.readFileSync(path.join(root,`dist/editions/${slug}/index.html`),'utf8');
  const run={id:1,head_sha:commit,head_branch:'main',event:'push',status:'completed',conclusion:'success',html_url:'https://github.com/hm2236/jamio-news/actions/runs/1'};
  const request=async url=>new Response(url.includes('api.github.com')?JSON.stringify({workflow_runs:[run]}):url.includes('publication.json')?JSON.stringify(manifest):html);
  assert.equal((await confirmPublication(root,slug,commit,{request})).variant,'evening');assert.equal((await verifyDeployment(root,commit,{request})).verifiedEdition.slug,slug);
  manifest.editions.find(e=>e.slug===slug).variant='noon';await assert.rejects(confirmPublication(root,slug,commit,{request}));await assert.rejects(verifyDeployment(root,commit,{request}));
});
test('trusted full-tree guard validates same-day variant alongside actual legacy files',t=>{
  const root=repository(t),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();git(['init']);
  const saveCommit=()=>{git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','Test']);return git(['rev-parse','HEAD']);};const baseSha=saveCommit(),f=draft(root);applyDraft(root,f.folder);
  // Drafts are deliberately excluded from the content-only candidate commit.
  git(['add','content']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','Evening fixture']);const headSha=git(['rev-parse','HEAD']),repo={full_name:'hm2236/jamio-news'};
  const event={repository:repo,pull_request:{number:8,base:{sha:baseSha,ref:'main',repo},head:{sha:headSha,ref:`daily/${slug}`,repo}}};
  const receipt=guardGitPR(root,event);assert.equal(receipt.slug,slug);assert.equal(receipt.variant,'evening');assert.equal(receipt.headSha,headSha);
  fs.appendFileSync(path.join(root,`content/editions/${date}.md`),'\nChanged');event.pull_request.head.sha=saveCommit();assert.throws(()=>guardGitPR(root,event),/forbidden/);
});
