import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {guardGitPR, guardCandidateChain, validateFreshness} from '../scripts/daily-pr.mjs';
import {readContent} from '../scripts/content.mjs';
import {serialize} from '../scripts/production.mjs';

const date='2026-10-07', slug=date+'-evening', branch='daily/'+slug;
const now=new Date(date+'T18:00:00+09:00'), marker='Candidate-Attempt: controlled-attempt-0001';
function repository(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jamio-hardening-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
  const write=(file,text)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);};
  const commit=(message='fixture')=>{git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--allow-empty','-m',message]);return git(['rev-parse','HEAD']);};
  git(['init']);write('site.config.json',fs.readFileSync(new URL('../site.config.json',import.meta.url),'utf8'));
  for(const a of readContent(new URL('../content/articles',import.meta.url)).filter(a=>a.kind==='guide'))write('content/articles/'+a.slug+'.md',serialize(a));
  for(const e of readContent(new URL('../content/editions',import.meta.url)).filter(e=>e.kind==='launch'))write('content/editions/'+e.slug+'.md',serialize(e));
  write('data/prices.json','[]');const base=commit();git(['update-ref','refs/remotes/origin/main',base]);
  const article={slug:slug+'-story',title:'Synthetic news',summary:'Test only',category:'ai',tags:[],status:'verified',kind:'news',published:date+'T17:00:00+09:00',verificationNote:'Test only',sources:[{title:'Source',type:'official',url:'https://fixture.example.jp/news',checked:date+'T16:00:00+09:00'}],body:'\nTest article body\n'};
  const edition={slug,date,variant:'evening',priceKeys:[],title:'Synthetic evening',kind:'daily',published:article.published,top5:[article.slug],hero:article.slug,articles:[article.slug],deals:[],production:{contractVersion:1,x:{status:'unavailable',note:'Test only'}},body:'\nTest edition body\n'};
  const articleFile='content/articles/'+article.slug+'.md', sealFile='content/editions/'+slug+'.md';
  const repo={full_name:'hm2236/jamio-news'},event={repository:repo,pull_request:{number:7,base:{ref:'main',sha:base,repo},head:{ref:branch,sha:base,repo}}};
  const guard=(options={})=>{event.pull_request.head.sha=git(['rev-parse','HEAD']);return guardGitPR(root,event,{now,...options});};
  const addArticle=()=>write(articleFile,serialize(article)), addSeal=()=>write(sealFile,serialize(edition));
  return {root,git,write,commit,base,article,edition,articleFile,sealFile,event,guard,addArticle,addSeal};
}
for (const kind of ['edition edit','article delete','article rename','price edit','content add']) test('non-daily PR rejects protected '+kind,t=>{
  const f=repository(t);f.event.pull_request.head.ref='fix/infrastructure';
  const file=f.git(['ls-tree','-r','--name-only','HEAD']).split('\n').find(x=>x.startsWith(kind.startsWith('edition')?'content/editions/':'content/articles/'));
  if(kind==='edition edit')fs.appendFileSync(path.join(f.root,file),'\nEdit');
  if(kind==='article delete')fs.unlinkSync(path.join(f.root,file));
  if(kind==='article rename')fs.renameSync(path.join(f.root,file),path.join(f.root,'content/articles/renamed.md'));
  if(kind==='price edit')f.write('data/prices.json','[{}]');
  if(kind==='content add')f.addArticle();
  f.commit();assert.throws(()=>f.guard(),/protected publication/);
});
for (const scenario of ['add', 'delete', 'rename']) test('non-daily PR rejects ephemeral recovery packet ' + scenario,t=>{
  const f=repository(t);
  f.event.pull_request.head.ref='fix/infrastructure';
  const packet='recovery-packets/2026-10-08-evening.json';
  if (scenario === 'add') {
    f.write(packet,'{"version":1}\n');
  } else {
    f.write(packet,'{"version":1}\n');
    const original=f.commit('Base with packet');
    f.event.pull_request.base.sha=original;
    f.git(['update-ref','refs/remotes/origin/main',original]);
    if (scenario === 'delete') f.git(['rm',packet]);
    else f.git(['mv',packet,'recovery-packets/renamed.json']);
  }
  f.commit();
  assert.throws(()=>f.guard(),/ephemeral recovery packet/);
});
test('non-daily infrastructure PR can change unrelated scripts without packet',t=>{
  const f=repository(t);
  f.event.pull_request.head.ref='fix/infrastructure';
  f.write('scripts/unrelated.mjs','export const example=true;\n');
  f.commit();
  assert.equal(f.guard().status,'infrastructure-passed');
});

test('infrastructure PR passes without executing candidate code, even behind main or from a fork',t=>{
  const f=repository(t);f.event.pull_request.head.ref='fix/docs';f.event.pull_request.head.repo={full_name:'fixture/fork'};
  f.write('scripts/evil.mjs','throw new Error("never execute")');const head=f.commit();
  f.git(['checkout','--detach',f.base]);f.write('content/articles/new-main.md','main only');const newer=f.commit();
  f.event.pull_request.base.sha=newer;f.git(['checkout','--detach',head]);assert.equal(f.guard().status,'infrastructure-passed');
});
test('valid single-commit local and multi-commit sealed candidates pass',t=>{
  const f=repository(t);f.addArticle();f.addSeal();f.commit();assert.equal(f.guard().candidateMode,'single-commit');
  f.git(['checkout','--detach',f.base]);f.addArticle();f.commit('Article\n\n'+marker);f.addSeal();const head=f.commit('Seal\n\n'+marker);
  const receipt=f.guard();assert.equal(receipt.candidateMode,'contents-v1');assert.equal(receipt.sealSha,head);assert.equal(receipt.attempt,'controlled-attempt-0001');assert.equal(receipt.expiresAt,'2026-10-07T15:00:00.000Z');
});
for(const kind of ['no seal','post seal','article modify','candidate delete','merge','article mismatch','mixed attempts','missing marker','price write','unrelated path','reverted intermediate edit','malformed single marker']) test('candidate rejects '+kind,t=>{
  const f=repository(t);f.addArticle();f.commit('Article\n\n'+marker);
  if(kind==='no seal'){assert.throws(()=>f.guard(),/add its edition/);return;}
  if(kind==='article modify'||kind==='reverted intermediate edit'){
    fs.appendFileSync(path.join(f.root,f.articleFile),'\nChanged');f.commit('Modify\n\n'+marker);
    if(kind==='reverted intermediate edit'){f.addArticle();f.commit('Revert\n\n'+marker);}
  }
  if(kind==='candidate delete'){fs.unlinkSync(path.join(f.root,f.articleFile));f.commit('Delete\n\n'+marker);f.addArticle();f.commit('Readd\n\n'+marker);}
  if(kind==='article mismatch')f.edition.articles.push(slug+'-absent');
  if(kind==='price write'){f.write('data/prices.json','[{}]');f.commit('Prices\n\n'+marker);f.write('data/prices.json','[]');f.commit('Restore\n\n'+marker);}
  if(kind==='unrelated path'){f.write('content/articles/'+date+'-morning-other.md','other');f.commit('Other\n\n'+marker);f.git(['rm','content/articles/'+date+'-morning-other.md']);f.commit('Delete\n\n'+marker);}
  f.addSeal();f.commit('Seal\n\n'+(kind==='mixed attempts'?'Candidate-Attempt: different-attempt-0002':kind==='missing marker'?'':marker));
  if(kind==='post seal')f.commit('Empty after seal\n\n'+marker);
  if(kind==='merge'){
    const head=f.git(['rev-parse','HEAD']),tree=f.git(['rev-parse','HEAD^{tree}']);
    const merge=f.git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit-tree',tree,'-p',head,'-p',f.base,'-m','Merge\n\n'+marker]);f.git(['reset','--hard',merge]);
  }
  if(kind==='malformed single marker'){f.git(['reset','--soft',f.base]);f.commit('Candidate-Attempt: short');}
  assert.throws(()=>f.guard());
});
test('stale expected base and unrelated head are rejected',t=>{
  const f=repository(t);f.addArticle();f.addSeal();f.commit();assert.throws(()=>f.guard({latestMainSha:'a'.repeat(40)}),/Stale PR base/);
  const head=f.git(['rev-parse','HEAD']);f.git(['checkout','--detach',f.base]);f.write('README.md','new main');const newer=f.commit();f.git(['update-ref','refs/remotes/origin/main',newer]);f.event.pull_request.base.sha=newer;f.git(['checkout','--detach',head]);assert.throws(()=>f.guard());
});
test('trusted guard rerun expires at JST midnight and rejects future publication',t=>{
  const f=repository(t);f.addArticle();f.addSeal();f.commit();assert.equal(f.guard().status,'guard-passed');
  assert.throws(()=>f.guard({now:new Date('2026-10-07T15:00:00Z')}),/Stale daily/);
  assert.throws(()=>f.guard({now:new Date(date+'T16:30:00+09:00')}),/future/);
});
test('freshness checks yesterday, date mismatch, future article, and invalid clock',()=>{
  const edition={published:date+'T17:00:00+09:00'},articles=[{published:edition.published}];
  assert.doesNotThrow(()=>validateFreshness(branch,edition,articles,now));
  for(const [e,a,n] of [[edition,articles,new Date('2026-10-07T15:00:00Z')],[{published:'2026-10-06T17:00:00+09:00'},articles,now],[edition,[{published:date+'T19:00:00+09:00'}],now],[edition,articles,new Date('invalid')]])assert.throws(()=>validateFreshness(branch,e,a,n));
});
test('attempt trailer duplicates, absent seal and wrong parent fail closed',()=>{
  const base='a'.repeat(40),head='b'.repeat(40),change={file:'content/editions/'+slug+'.md',status:'A',mode:'100644'};
  assert.throws(()=>guardCandidateChain(branch,[],base,head));
  assert.throws(()=>guardCandidateChain(branch,[{sha:head,parents:[base],changes:[change],message:marker+'\n'+marker}],base,head));
  assert.throws(()=>guardCandidateChain(branch,[{sha:head,parents:['c'.repeat(40)],changes:[change],message:''}],base,head));
});
test('workflows always guard PRs and consecutive main deployments preserve running receipts',()=>{
  const guard=fs.readFileSync(new URL('../.github/workflows/daily-publication.yml',import.meta.url),'utf8');
  assert.ok(guard.includes('pull_request_target:'));assert.ok(guard.includes('ref: ${{ github.event.pull_request.base.sha }}'));assert.ok(guard.includes('git fetch origin main'));assert.equal(/if:.*startsWith/.test(guard),false);
  const pages=fs.readFileSync(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
  assert.ok(pages.includes('queue: max'));assert.equal(pages.includes('cancel-in-progress:'),false);assert.ok(pages.includes('group: pages-${{ github.ref }}'));
});
