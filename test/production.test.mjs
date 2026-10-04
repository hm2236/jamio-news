import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {initDraft, applyDraft, planDraft, serialize, loadRepository, editionDigest} from '../scripts/production.mjs';
import {isDate, isJST, contract} from '../scripts/contract.mjs';
import {confirmPublication} from '../scripts/confirm-publication.mjs';
import {validate, validatePrices, parse} from '../scripts/content.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const date = '2026-10-05', commit = 'a'.repeat(40);
// Synthetic fixtures live only in temporary repositories, never production content.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamio-production-'));
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected fixture cleanup path');
    fs.rmSync(root, {recursive: true, force: true});
  });
  for (const name of ['content', 'data', 'docs', 'public', 'scripts', 'contracts', 'site.config.json']) fs.cpSync(path.join(sourceRoot,name),path.join(root,name),{recursive:true});
  // Keep fixtures independent of real daily editions added after this increment.
  for (const dir of ['content/articles','content/editions']) for (const name of fs.readdirSync(path.join(root,dir))) {
    if (!name.endsWith('.md')) continue;
    const file=path.join(root,dir,name), item=parse(fs.readFileSync(file,'utf8'),name);
    if (['news','daily'].includes(item.kind)) fs.rmSync(file);
  }
  fs.writeFileSync(path.join(root,'data/prices.json'),'[]\n');
  initDraft(root,date);
  const folder = path.join(root,'drafts',date);
  const articles = Array.from({length:5}, (_,i) => ({slug:`${date}-fixture-${i}`,title:`Fixture story ${i}`,summary:'Test fixture only',category:'ai',tags:['fixture'],status:'verified',kind:'news',published:`${date}T08:00:00+09:00`,verificationNote:'Synthetic test evidence',sources:[{title:'Test source',type:'official',url:`https://fixture-source.example.jp/${i}`,checked:`${date}T07:30:00+09:00`}],body:'\nTest body.\n'}));
  const slugs=articles.map(a=>a.slug);
  const edition={slug:date,title:'Fixture edition',kind:'daily',published:`${date}T08:00:00+09:00`,top5:slugs.slice(),hero:slugs[0],articles:slugs,deals:[],production:{contractVersion:1,x:{status:'unavailable',note:'Test fixture: X access unavailable; use official sources'}},body:'\nTest edition body.\n'};
  const prices=[];
  const save=()=>{
    fs.writeFileSync(path.join(folder,'edition.md'),serialize(edition));
    for(const article of articles)fs.writeFileSync(path.join(folder,'articles',`${article.slug}.md`),serialize(article));
    fs.writeFileSync(path.join(folder,'prices.json'),JSON.stringify(prices));
  };
  save();
  return {root,folder,articles,edition,prices,save};
}
const price=(changes={})=>({product:'Fixture GPU',sku:'fixture-sku',shop:'fixture-shop',condition:'New, tax and shipping included',currency:'JPY',total:100000,url:'https://fixture-shop.example.jp/item',observed:`${date}T07:30:00+09:00`,verdict:'wait',reason:'Test fixture only',...changes});

test('scaffolding validates real dates, creates no news/prices, and never overwrites a draft',t=>{
 const f=fixture(t);assert.equal(isDate('2026-02-30'),false);assert.equal(isDate('2028-02-29'),true);assert.equal(isJST('2026-02-30T08:00:00+09:00'),false);assert.equal(isJST(`${date}T25:00:00+09:00`),false);
 assert.throws(()=>initDraft(f.root,date),/already exists/);
 const fresh=initDraft(f.root,'2026-10-06');assert.deepEqual(fs.readdirSync(path.join(fresh.folder,'articles')),[]);assert.equal(fs.readFileSync(path.join(fresh.folder,'prices.json'),'utf8'),'[]\n');assert.throws(()=>planDraft(f.root,fresh.folder));
});
test('edition digest and retries are portable across Windows CRLF and Linux LF',t=>{
 const f=fixture(t),before=planDraft(f.root,f.folder).digest;
 for(const file of [path.join(f.folder,'edition.md'),...f.articles.map(a=>path.join(f.folder,'articles',`${a.slug}.md`))])fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/\n/g,'\r\n'));
 assert.equal(planDraft(f.root,f.folder).digest,before);applyDraft(f.root,f.folder);assert.equal(applyDraft(f.root,f.folder).status,'unchanged');
});
test('one valid edition applies, appends observations, and identical retries make no changes',t=>{
 const f=fixture(t);const history=price({observed:'2026-10-04T07:30:00+09:00'});fs.writeFileSync(path.join(f.root,'data/prices.json'),JSON.stringify([history]));f.prices.push(price());f.save();
 const plan=planDraft(f.root,f.folder);assert.equal(plan.writes.length,7);assert.equal(applyDraft(f.root,f.folder).status,'applied');
 assert.equal(applyDraft(f.root,f.folder).status,'unchanged');assert.deepEqual(loadRepository(f.root).prices,[history,price()]);
 f.prices.push(price({observed:`${date}T07:31:00+09:00`}));f.save();assert.throws(()=>applyDraft(f.root,f.folder),/Same-day package conflict/);assert.equal(loadRepository(f.root).prices.length,2);
});
test('same-day story/edition differences stop without changing published files',t=>{
 const f=fixture(t);applyDraft(f.root,f.folder);const file=path.join(f.root,'content/articles',`${f.articles[0].slug}.md`),before=fs.readFileSync(file,'utf8');f.articles[0].summary='Changed';f.save();assert.throws(()=>applyDraft(f.root,f.folder),/collision/);assert.equal(fs.readFileSync(file,'utf8'),before);
 f.articles[0].summary='Test fixture only';f.edition.title='Changed edition';f.save();assert.throws(()=>applyDraft(f.root,f.folder),/Same-day edition conflict/);
});
test('ordinary write failure rolls back the whole edition and preserves price history',t=>{
 const f=fixture(t);f.prices.push(price());f.save();const priceFile=path.join(f.root,'data/prices.json'),before=fs.readFileSync(priceFile,'utf8');const write=fs.writeFileSync;
 let failed=false;t.mock.method(fs,'writeFileSync',(file,...args)=>{if(file===priceFile&&!failed){failed=true;throw new Error('Simulated write failure');}return write(file,...args);});
 assert.throws(()=>applyDraft(f.root,f.folder),/Simulated/);assert.equal(fs.readFileSync(priceFile,'utf8'),before);assert.equal(fs.existsSync(path.join(f.root,'content/editions',`${date}.md`)),false);assert.ok(f.articles.every(a=>!fs.existsSync(path.join(f.root,'content/articles',`${a.slug}.md`))));
});
test('incomplete, malformed, unsafe and unreferenced articles fail before writes',t=>{
 const f=fixture(t);const original=structuredClone(f.articles[0]);
 for(const changes of [{body:'  '},{published:'2026-02-30T08:00:00+09:00'},{sources:[]},{category:'missing'},{extra:'typo'},{sources:[{...original.sources[0],url:'https://example.com/news'}]},{sources:[{...original.sources[0],checked:`${date}T08:01:00+09:00`}]},{body:'```\nunclosed'}]){
  f.articles[0]={...original,...changes};f.save();assert.throws(()=>applyDraft(f.root,f.folder));assert.equal(fs.existsSync(path.join(f.root,'content/editions',`${date}.md`)),false);
 }
 f.articles[0]=original;f.edition.top5.pop();f.save();assert.throws(()=>planDraft(f.root,f.folder),/too few/);
 f.edition.top5=f.articles.map(a=>a.slug);f.save();fs.writeFileSync(path.join(f.folder,'articles',`${date}-extra.md`),serialize({...original,slug:`${date}-extra`}));assert.throws(()=>planDraft(f.root,f.folder),/exactly/);
});
test('X unavailable cannot be used as retrieved evidence; X alone remains unverified',t=>{
 const f=fixture(t);const x={title:'Fixture X post',type:'x',url:'https://x.com/fixture/status/123',checked:`${date}T07:30:00+09:00`,author:'Fixture author',postPublished:`${date}T07:00:00+09:00`,claim:'Fixture claim',identityNote:'Fixture identity check'};
 f.articles[0].status='unconfirmed';f.articles[0].sources=[x];f.save();assert.throws(()=>planDraft(f.root,f.folder),/Cannot claim X/);
 f.edition.production.x.status='partial';f.save();assert.doesNotThrow(()=>planDraft(f.root,f.folder));
 delete x.identityNote;f.save();assert.throws(()=>planDraft(f.root,f.folder),/identityNote/);x.identityNote='Fixture identity';
 f.articles[0].status='verified';x.type='official';f.save();assert.throws(()=>planDraft(f.root,f.folder),/一次資料/);
});
test('price duplicates, conflicting history, invalid totals, fake URLs and wrong date fail',t=>{
 const f=fixture(t);
 for(const rows of [[price(),price()],[price({total:0})],[price({total:1.5})],[price({url:'https://example.com/item'})],[price({observed:'2026-10-04T07:30:00+09:00'})],[price({observed:`${date}T08:01:00+09:00`})]]){
  f.prices.splice(0,f.prices.length,...rows);f.save();assert.throws(()=>applyDraft(f.root,f.folder));
 }
 fs.writeFileSync(path.join(f.root,'data/prices.json'),JSON.stringify([price()]));f.prices.splice(0,f.prices.length,price({total:90000}));f.save();assert.throws(()=>applyDraft(f.root,f.folder),/Price observation conflict/);
 assert.throws(()=>validatePrices({}),/array/);
});
test('direct content writes and builds use the same daily contract',t=>{
 const f=fixture(t);applyDraft(f.root,f.folder);const repository=loadRepository(f.root);delete repository.editions.find(e=>e.slug===date).production;assert.throws(()=>validate(repository.articles,repository.editions,repository.config),/production/);
 const file=path.join(f.root,'content/editions',`${date}.md`);const edition=structuredClone(f.edition);delete edition.production;fs.writeFileSync(file,serialize(edition));
 assert.throws(()=>execFileSync(process.execPath,['scripts/build.mjs'],{cwd:f.root,env:{...process.env,GITHUB_SHA:commit},stdio:'pipe'}));
});
test('daily build keeps launch history, RSS/search/tags and emits matching publication receipts',t=>{
 const f=fixture(t);applyDraft(f.root,f.folder);execFileSync(process.execPath,['scripts/build.mjs'],{cwd:f.root,env:{...process.env,GITHUB_SHA:commit}});
 const dist=path.join(f.root,'dist');const repo=loadRepository(f.root);const receipt=JSON.parse(fs.readFileSync(path.join(dist,'publication.json'),'utf8'));const entry=receipt.editions.find(e=>e.date===date);
 assert.equal(receipt.commit,commit);assert.equal(entry.digest,editionDigest(f.edition,repo.articles,[]));assert.ok(fs.readFileSync(path.join(dist,`editions/${date}/index.html`),'utf8').includes(entry.digest));
 const search=JSON.parse(fs.readFileSync(path.join(dist,'search.json'),'utf8'));assert.equal(search.length,repo.articles.length);assert.ok(search.some(a=>a.tags.includes('fixture')));
 assert.equal((fs.readFileSync(path.join(dist,'rss.xml'),'utf8').match(/<item>/g)||[]).length,repo.articles.length+repo.editions.length);assert.ok(fs.existsSync(path.join(dist,'editions/2026-10-04/index.html')));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dist,'contracts/publishing.schema.json'),'utf8')),contract);
});
test('publication confirmation requires exact successful main workflow, receipt and HTML, never a 200 alone',async t=>{
 const f=fixture(t);applyDraft(f.root,f.folder);execFileSync(process.execPath,['scripts/build.mjs'],{cwd:f.root,env:{...process.env,GITHUB_SHA:commit}});
 const manifest=JSON.parse(fs.readFileSync(path.join(f.root,'dist/publication.json'),'utf8'));let html=fs.readFileSync(path.join(f.root,'dist',`editions/${date}/index.html`),'utf8');
 const run={id:1,head_sha:commit,head_branch:'main',event:'push',status:'completed',conclusion:'success',html_url:'https://github.com/hm2236/jamio-news/actions/runs/1'};
 let status=200;
 const request=async url=>new Response(url.includes('api.github.com')?JSON.stringify({workflow_runs:[run]}):url.includes('publication.json')?JSON.stringify(manifest):html,{status});
 assert.equal((await confirmPublication(f.root,date,commit,{request})).status,'published');
 run.conclusion='failure';await assert.rejects(confirmPublication(f.root,date,commit,{request}),/not succeeded/);run.conclusion='success';
 run.head_sha='b'.repeat(40);await assert.rejects(confirmPublication(f.root,date,commit,{request}),/not succeeded/);run.head_sha=commit;
 manifest.commit='b'.repeat(40);await assert.rejects(confirmPublication(f.root,date,commit,{request}),/manifest/);manifest.commit=commit;
 manifest.editions.find(e=>e.date===date).digest='stale';await assert.rejects(confirmPublication(f.root,date,commit,{request}),/manifest/);manifest.editions.find(e=>e.date===date).digest=editionDigest(f.edition,f.articles,[]);
 html='<html>Old page with HTTP 200</html>';await assert.rejects(confirmPublication(f.root,date,commit,{request}),/HTML/);
 status=404;await assert.rejects(confirmPublication(f.root,date,commit,{request}),/HTTP 404/);
});
