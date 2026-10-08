import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateTrustedPacketCommit, trustedPreview} from '../scripts/recovery-trusted-pr.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const day = '2026-10-09', slug = day + '-evening';
const now = () => new Date(day + 'T18:00:00+09:00');

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'jamio-trusted-pr-test-'));
  t.after(() => fs.rmSync(temp,{recursive:true,force:true}));
  const root = path.join(temp,'trusted'); fs.mkdirSync(root);
  for (const name of ['content','data','docs','public','scripts','contracts','config','site.config.json']) {
    fs.cpSync(path.join(source,name),path.join(root,name),{recursive:true});
  }
  const git = args => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
  const commit = text => {
    git(['add','.']);
    git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m',text]);
    return git(['rev-parse','HEAD']);
  };
  git(['init']);
  const baseSha = commit('trusted fixture main');
  const article={slug:slug+'-fixture-story',title:'Synthetic verified story',
    summary:'Synthetic test, never for publication',category:'ai',tags:['synthetic'],
    status:'verified',kind:'news',published:day+'T17:30:00+09:00',
    verificationNote:'Synthetic fixture for trusted preview only',
    sources:[{title:'Fixture source',type:'official',url:'https://fixture.example.jp/stories/test',
      checked:day+'T17:00:00+09:00'}],
    body:'\n# Synthetic article\n\nNo live claims are made here.'};
  const edition={slug,date:day,variant:'evening',priceKeys:[],title:'Synthetic test edition',
    kind:'daily',published:day+'T17:45:00+09:00',top5:[article.slug],
    hero:article.slug,articles:[article.slug],deals:[],
    production:{contractVersion:1,x:{status:'not-used',note:'No X was accessed in synthetic test'}},
    body:'\n# Synthetic editorial test'};
  const packet={version:1,baseSha,package:{date:day,edition,articles:[article],priceObservations:[]}};
  const file='recovery-packets/'+slug+'.json';
  const write = (name,data) => {
    fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});
    fs.writeFileSync(path.join(root,name),data);
  };
  write(file,JSON.stringify(packet,null,2)+'\n');
  const headSha=commit('One-file packet probe');
  const event={repository:{full_name:'hm2236/jamio-news'},pull_request:{
    number:91,state:'open',
    base:{ref:'main',sha:baseSha,repo:{full_name:'hm2236/jamio-news'}},
    head:{ref:'recovery/synthetic-packet',sha:headSha,repo:{full_name:'hm2236/jamio-news'}}
  }};
  const mock=(changeAfterFirst=false) => {
    let mains=0;
    return async url => {
      const resource=url.split('/repos/hm2236/jamio-news')[1];
      if (resource==='/git/ref/heads/main') {
        mains++;
        return new Response(JSON.stringify({object:{sha:changeAfterFirst&&mains>1?'f'.repeat(40):baseSha}}));
      }
      if (resource==='/pulls/91')return new Response(JSON.stringify({state:'open',
        head:{sha:headSha,repo:{full_name:'hm2236/jamio-news'}},base:{sha:baseSha}}));
      if (resource.startsWith('/git/ref/heads/daily/'))return new Response('not found',{status:404});
      if (resource.startsWith('/pulls?'))return new Response('[]');
      throw Error('Unexpected outbound request: '+resource);
    };
  };
  return {root,temp,git,commit,write,baseSha,headSha,file,packet,event,mock,
    output:path.join(temp,'preview')};
}

test('trusted main reads a one-commit packet-only PR as data and exports verified preview',async t=>{
  const f=fixture(t);
  f.git(['checkout','--detach',f.baseSha]); // trusted base checkout, head read only as git object
  const validated=validateTrustedPacketCommit(f.root,f.event);
  assert.equal(validated.baseSha,f.baseSha);
  assert.equal(validated.headSha,f.headSha);
  assert.equal(validated.slug,slug);
  assert.match(validated.packetSha256,/^[a-f0-9]{64}$/);
  const result=await trustedPreview(f.root,f.event,f.output,{request:f.mock(),now});
  assert.equal(result.status,'trusted-preview-ready');
  assert.equal(result.publicationAuthorized,false);
  assert.equal(result.editorialReviewRequired,true);
  assert.equal(result.baseSha,f.baseSha);
  assert.equal(result.headSha,f.headSha);
  const receipt=JSON.parse(fs.readFileSync(path.join(f.output,'trusted-preview.json'),'utf8'));
  assert.equal(receipt.packetSha256,validated.packetSha256);
  assert.equal(receipt.slug,slug);
  assert.equal(receipt.digest,result.digest);
  assert.equal(fs.existsSync(path.join(f.output,'offline-review.html')),true);
  assert.equal(f.git(['status','--porcelain']),'');
});

test('trusted main rejects extra files, multi-commit packet branches and modified base',t=>{
  const extra=fixture(t);
  extra.write('scripts/untrusted-helper.mjs','throw new Error("must not execute");\n');
  extra.event.pull_request.head.sha=extra.commit('Unsafe extra script');
  extra.git(['checkout','--detach',extra.baseSha]);
  assert.throws(()=>validateTrustedPacketCommit(extra.root,extra.event),/one add-only commit/);
  const wrong=fixture(t);
  wrong.git(['checkout','--detach',wrong.baseSha]);
  wrong.event.pull_request.base.sha='0'.repeat(40);
  assert.throws(()=>validateTrustedPacketCommit(wrong.root,wrong.event),/checkout SHA/);
  const fork=fixture(t);
  fork.git(['checkout','--detach',fork.baseSha]);
  fork.event.pull_request.head.repo.full_name='attacker/fork';
  assert.throws(()=>validateTrustedPacketCommit(fork.root,fork.event),/same-repository/);
});

test('trusted main rejects payload/file identity differences and non regular packet mode',t=>{
  // The negative probes must remain SINGLE-commit heads; otherwise only the
  // multi-commit guard runs and their actual safety conditions go untested.
  const reseal=f=>{
    f.git(['reset','--soft',f.baseSha]);
    f.event.pull_request.head.sha=f.commit('One-file malicious data candidate');
    f.git(['checkout','--detach',f.baseSha]);
  };
  const bad=fixture(t);
  bad.packet.baseSha='f'.repeat(40);
  bad.write(bad.file,JSON.stringify(bad.packet));
  reseal(bad);
  assert.throws(()=>validateTrustedPacketCommit(bad.root,bad.event),/identity\/base mismatch/);

  const badLink=fixture(t);
  badLink.git(['rm',badLink.file]);
  fs.mkdirSync(path.dirname(path.join(badLink.root,badLink.file)),{recursive:true});
  fs.symlinkSync('../site.config.json',path.join(badLink.root,badLink.file));
  reseal(badLink);
  assert.throws(()=>validateTrustedPacketCommit(badLink.root,badLink.event),/regular file/);

  const outside=fixture(t);
  outside.write('scripts/untrusted.js','no execution is allowed\n');
  reseal(outside);
  assert.throws(()=>validateTrustedPacketCommit(outside.root,outside.event),/only one packet file/);
});

test('trusted preview discards all output if main advances during final collision check',async t=>{
  const f=fixture(t);
  f.git(['checkout','--detach',f.baseSha]);
  await assert.rejects(
    trustedPreview(f.root,f.event,f.output,{request:f.mock(true),now}),/Main changed/);
  assert.equal(fs.existsSync(f.output),false);
  assert.equal(f.git(['status','--porcelain']),'');
});

test('trusted preview fails closed on daily branch collision',async t=>{
  const f=fixture(t);
  f.git(['checkout','--detach',f.baseSha]);
  const request=async url=>{
    if(url.endsWith('/git/ref/heads/main'))return new Response(JSON.stringify({object:{sha:f.baseSha}}));
    if(url.endsWith('/pulls/91'))return new Response(JSON.stringify({
      state:'open',head:{sha:f.headSha,repo:{full_name:'hm2236/jamio-news'}},
      base:{sha:f.baseSha}}));
    if(url.includes('/git/ref/heads/daily/'))return new Response(JSON.stringify({object:{sha:'f'.repeat(40)}}));
    return new Response('[]');
  };
  await assert.rejects(trustedPreview(f.root,f.event,f.output,{request,now}),/daily branch/);
  assert.equal(fs.existsSync(f.output),false);
});
