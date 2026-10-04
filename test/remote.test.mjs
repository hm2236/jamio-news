import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {readContent} from '../scripts/content.mjs';
import {serialize} from '../scripts/production.mjs';
import {guardPaths, validateDailyChange, guardGitPR} from '../scripts/daily-pr.mjs';
import {validateRemotePR, confirmRemotePublication} from '../scripts/remote-proof.mjs';

const date='2026-10-05', branch=`daily/${date}`, baseSha='a'.repeat(40), headSha='b'.repeat(40), mainSha='c'.repeat(40);
const config=JSON.parse(fs.readFileSync(new URL('../site.config.json',import.meta.url)));
const guides=readContent(new URL('../content/articles',import.meta.url)).filter(a=>a.kind==='guide');
const launch=readContent(new URL('../content/editions',import.meta.url)).filter(e=>e.kind==='launch');
const row=(changes={})=>({product:'Synthetic test GPU',sku:'test-sku',shop:'test-shop',condition:'Tax and shipping included',currency:'JPY',total:100000,url:'https://fixture-shop.example.jp/item',observed:`${date}T06:30:00+09:00`,verdict:'wait',reason:'Test only',...changes});
const change=(file,status='A',mode='100644')=>({file,status,mode});
function fixture() {
 const articles=Array.from({length:5},(_,i)=>({slug:`${date}-fixture-${i}`,title:`Test story ${i}`,summary:'Synthetic fixture only',category:'ai',tags:[],status:'verified',kind:'news',published:`${date}T06:45:00+09:00`,verificationNote:'Test-only verification',sources:[{title:'Test source',type:'official',url:`https://fixture-source.example.jp/${i}`,checked:`${date}T06:30:00+09:00`}],body:'\nTest body\n'}));
 const slugs=articles.map(a=>a.slug);
 const edition={slug:date,title:'Test edition',kind:'daily',published:`${date}T06:45:00+09:00`,top5:slugs.slice(),hero:slugs[0],articles:slugs,deals:[],production:{contractVersion:1,x:{status:'unavailable',note:'Test only; no X retrieval'}},body:'\nTest edition body\n'};
 const base={config,articles:guides,editions:launch,prices:[row({observed:'2026-10-04T06:30:00+09:00'})]};
 const candidate={config,articles:[...guides,...articles],editions:[...launch,edition],prices:[...base.prices,row()]};
 const changes=[...articles.map(a=>change(`content/articles/${a.slug}.md`)),change(`content/editions/${date}.md`),change('data/prices.json','M')];
 return {base:structuredClone(base),candidate:structuredClone(candidate),changes,edition,articles};
}
test('daily path guard allows only same-date regular article/edition additions and price modification',()=>{
 const f=fixture();assert.equal(guardPaths(branch,f.changes),date);
 for(const file of ['scripts/build.mjs','contracts/publishing.schema.json','.github/workflows/pages.yml','test/content.test.mjs','public/assets/app.js','README.md','content/articles/welcome.md','content/editions/2026-10-06.md','content/articles/2026-10-06-news.md','content/articles/2026-10-05-../escape.md'])assert.throws(()=>guardPaths(branch,[...f.changes,change(file)]),/forbidden/);
 for(const status of ['M','D','R100','C100','T'])assert.throws(()=>guardPaths(branch,[...f.changes,change(`content/articles/${date}-other.md`,status)]),/forbidden/);
 for(const mode of ['120000','100755','160000'])assert.throws(()=>guardPaths(branch,[...f.changes,change(`content/articles/${date}-other.md`,'A',mode)]),/forbidden/);
 for(const name of ['daily/2026-02-30','daily/2026-10-05/other','daily/no-date','other/2026-10-05'])assert.throws(()=>guardPaths(name,f.changes));
 assert.throws(()=>guardPaths(branch,[]),/add its edition/);
});
test('remote package shares the local contract and can publish with no price observations',()=>{
 const f=fixture();assert.match(validateDailyChange(branch,f.changes,f.base,f.candidate).digest,/^[a-f0-9]{64}$/);
 f.candidate.prices=f.base.prices.slice();f.changes=f.changes.filter(c=>c.file!=='data/prices.json');assert.doesNotThrow(()=>validateDailyChange(branch,f.changes,f.base,f.candidate));
});
test('remote same-day conflicts, replaced history, duplicates and out-of-date observations fail',()=>{
 const cases=[f=>f.base.editions.push(f.edition),f=>f.base.articles.push(f.articles[0]),f=>f.candidate.prices[0].total--,f=>f.candidate.prices.pop(),f=>f.candidate.prices.push(row()),f=>f.candidate.prices[1].observed='2026-10-04T06:31:00+09:00',f=>f.candidate.prices[1].observed=`${date}T06:50:00+09:00`];
 for(const mutate of cases){const f=fixture();mutate(f);assert.throws(()=>validateDailyChange(branch,f.changes,f.base,f.candidate));}
});
test('remote top five, body, source status, X state and timestamps retain strict validation',()=>{
 const cases=[f=>f.candidate.editions.at(-1).top5.pop(),f=>f.candidate.editions.at(-1).top5[1]=f.edition.top5[0],f=>f.candidate.articles.at(-1).body=' ',f=>f.candidate.articles.at(-1).sources=[],f=>f.candidate.articles.at(-1).status='reported',f=>f.candidate.articles.at(-1).published='2026-10-06T06:45:00+09:00',f=>f.candidate.articles.at(-1).sources[0].checked=`${date}T06:50:00+09:00`,f=>{const a=f.candidate.articles.at(-1);a.status='unconfirmed';a.sources[0]={...a.sources[0],type:'x',url:'https://x.com/fixture/status/1'};}];
 for(const mutate of cases){const f=fixture();mutate(f);assert.throws(()=>validateDailyChange(branch,f.changes,f.base,f.candidate));}
});
test('trusted Git guard compares full base/head trees, not only the last commit or API file page',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jamio-remote-'));
 t.after(()=>{if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir()))throw new Error('Unexpected cleanup path');fs.rmSync(root,{recursive:true,force:true});});
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 const write=(file,text)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);};
 const commit=()=>{git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','Test fixture']);return git(['rev-parse','HEAD']);};
 const f=fixture();git(['init']);write('site.config.json',JSON.stringify(config));for(const a of f.base.articles)write(`content/articles/${a.slug}.md`,serialize(a));for(const e of f.base.editions)write(`content/editions/${e.slug}.md`,serialize(e));write('data/prices.json',JSON.stringify(f.base.prices));const base=commit();
 for(const a of f.articles)write(`content/articles/${a.slug}.md`,serialize(a));write(`content/editions/${date}.md`,serialize(f.edition));write('data/prices.json',JSON.stringify(f.candidate.prices));const head=commit();
 const repo={full_name:'hm2236/jamio-news'},event={repository:repo,pull_request:{number:7,base:{ref:'main',sha:base,repo},head:{ref:branch,sha:head,repo}}};
 const receipt=guardGitPR(root,event);assert.equal(receipt.headSha,head);assert.equal(receipt.baseSha,base);assert.equal(receipt.digest,validateDailyChange(branch,f.changes,f.base,f.candidate).digest);
 write('scripts/escape.mjs','throw new Error("must not execute candidate code");');event.pull_request.head.sha=commit();assert.throws(()=>guardGitPR(root,event),/forbidden/);
 event.pull_request.head.repo={full_name:'other/fork'};assert.throws(()=>guardGitPR(root,event),/same-repository/);
 event.pull_request.head.repo=repo;event.pull_request.base.sha=event.pull_request.head.sha;event.pull_request.head.sha=head;assert.throws(()=>guardGitPR(root,event));
});
function proofFixture() {
 const repo={full_name:'hm2236/jamio-news'},digest='d'.repeat(64),url=`https://hm2236.github.io/jamio-news/editions/${date}/`;
 const pr={number:7,state:'open',base:{sha:baseSha,ref:'main',repo},head:{sha:headSha,ref:branch,repo}};
 const run=(workflow,event,sha)=>({path:`.github/workflows/${workflow}`,event,head_sha:sha,status:'completed',conclusion:'success',head_branch:event==='pull_request'?branch:'main',html_url:'https://github.com/hm2236/jamio-news/actions/runs/1'});
 const validation={pr,expectedHead:headSha,expectedBase:baseSha,latestMainSha:baseSha,guardRun:run('daily-publication.yml','pull_request_target',baseSha),guardReceipt:{status:'guard-passed',contractVersion:1,pr:7,date,baseSha,headSha,digest,editionUrl:url},buildRun:run('pages.yml','pull_request',headSha)};
 const published={validated:validateRemotePR(validation),mergeResult:{merged:true,sha:mainSha},mergedPR:{...pr,merged:true,merge_commit_sha:mainSha},mainRun:run('pages.yml','push',mainSha),manifest:{contractVersion:1,commit:mainSha,editions:[{date,url,digest}]},html:`<link rel="canonical" href="${url}"><meta name="jamio-edition-digest" content="${digest}">`};
 return {validation,published};
}
test('API-only confirmation accepts exact validated head, merged main SHA and matching public receipt/HTML',()=>{
 const f=proofFixture();assert.equal(confirmRemotePublication(f.published).status,'published');
});
test('remote confirmation rejects skipped/stale CI, changed heads/bases and stale or missing publication receipts',()=>{
 for(const mutate of [f=>f.pr.head.sha=mainSha,f=>f.latestMainSha=mainSha,f=>f.guardReceipt.headSha=mainSha,f=>f.guardReceipt.baseSha=mainSha,f=>f.guardReceipt.pr=8,f=>f.guardRun.conclusion='skipped',f=>f.guardRun.head_sha=headSha,f=>f.buildRun.conclusion='failure',f=>f.buildRun.head_sha=baseSha]){const f=proofFixture();mutate(f.validation);assert.throws(()=>validateRemotePR(f.validation));}
 for(const mutate of [f=>f.mergeResult.merged=false,f=>f.mergedPR.head.sha=baseSha,f=>f.mergedPR.merge_commit_sha=headSha,f=>f.mainRun.conclusion='failure',f=>f.mainRun.head_sha=headSha,f=>f.manifest.commit=headSha,f=>f.manifest.editions[0].date='2026-10-04',f=>f.manifest.editions[0].url='https://hm2236.github.io/jamio-news/',f=>f.manifest.editions[0].digest='0'.repeat(64),f=>f.html='<html>HTTP 200, stale edition</html>']){const f=proofFixture();mutate(f.published);assert.throws(()=>confirmRemotePublication(f.published));}
});
