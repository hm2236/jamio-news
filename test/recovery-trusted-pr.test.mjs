import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateTrustedPacketCommit, trustedPreview, classifyTrustedPreviewFailure} from '../scripts/recovery-trusted-pr.mjs';

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
    return async (url,{headers}) => {
      assert.equal(headers.Authorization,'Bearer fixture-readonly-api-token');
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
  const runContext={repository:'hm2236/jamio-news',eventName:'pull_request_target',
    ref:'refs/heads/main',sha:baseSha,
    workflowRef:'hm2236/jamio-news/.github/workflows/trusted-recovery-preview.yml@refs/heads/main',
    workflowSha:baseSha,runId:'12345',runAttempt:'1'};
  const options={runContext,token:'fixture-readonly-api-token'};
  return {root,temp,git,commit,write,baseSha,headSha,file,packet,event,mock,runContext,options,
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
  const result=await trustedPreview(f.root,f.event,f.output,{...f.options,request:f.mock(),now});
  assert.equal(result.status,'trusted-preview-ready');
  assert.equal(result.publicationAuthorized,false);
  assert.equal(result.editorialReviewRequired,true);
  assert.equal(result.baseSha,f.baseSha);
  assert.equal(result.headSha,f.headSha);
  const receipt=JSON.parse(fs.readFileSync(path.join(f.output,'trusted-preview.json'),'utf8'));
  assert.equal(receipt.packetSha256,validated.packetSha256);
  assert.equal(receipt.slug,slug);
  assert.equal(receipt.digest,result.digest);
  assert.equal(receipt.eventName,'pull_request_target');
  assert.equal(receipt.workflowSha,f.baseSha);
  assert.equal(receipt.runId,'12345');
  assert.equal(receipt.runAttempt,1);
  assert.equal(receipt.attestationRequired,true);
  assert.ok(Date.parse(receipt.expiresAt)>Date.parse(receipt.validatedAt));
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
  const symlinkBlob=execFileSync('git',['hash-object','-w','--stdin'],{
    cwd:badLink.root,encoding:'utf8',input:'../site.config.json'
  }).trim();
  badLink.git(['update-index','--add','--cacheinfo','120000,'+symlinkBlob+','+badLink.file]);
  badLink.git(['reset','--soft',badLink.baseSha]);
  badLink.git(['-c','user.name=Fixture','-c','user.email=fixture@example.test',
    'commit','-m','One-file git-index symlink candidate']);
  badLink.event.pull_request.head.sha=badLink.git(['rev-parse','HEAD']);
  badLink.git(['checkout','--detach',badLink.baseSha]);
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
    trustedPreview(f.root,f.event,f.output,{...f.options,request:f.mock(true),now}),/Main changed/);
  assert.equal(fs.existsSync(f.output),false);
  assert.equal(f.git(['status','--porcelain']),'');
});

test('trusted preview drops output if midnight JST arrives after final live check',async t=>{
  const f=fixture(t);
  f.git(['checkout','--detach',f.baseSha]);
  let calls=0;
  const clock=()=>++calls<=2
    ?new Date('2026-10-09T23:59:58+09:00')
    :new Date('2026-10-10T00:00:01+09:00');
  await assert.rejects(
    trustedPreview(f.root,f.event,f.output,{...f.options,request:f.mock(),now:clock}),/Stale/);
  assert.equal(fs.existsSync(f.output),false);
  assert.equal(f.git(['status','--porcelain']),'');
});

test('trusted run identity is exact-main only, and unauthenticated fetches are rejected',async t=>{
  const f=fixture(t);
  f.git(['checkout','--detach',f.baseSha]);
  const wrong={...f.runContext,workflowRef:'hm2236/jamio-news/.github/workflows/trusted-recovery-preview.yml@refs/heads/recovery/fake'};
  await assert.rejects(trustedPreview(f.root,f.event,f.output,{
    ...f.options,runContext:wrong,request:f.mock(),now}),/workflow identity mismatch/);
  await assert.rejects(trustedPreview(f.root,f.event,f.output,{
    ...f.options,token:'',request:f.mock(),now}),/token unavailable/);
  assert.equal(fs.existsSync(f.output),false);
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
  await assert.rejects(trustedPreview(f.root,f.event,f.output,{...f.options,request,now}),/daily branch/);
  assert.equal(fs.existsSync(f.output),false);
});


test('trusted preview refuses a competing open recovery packet PR for the same slug',async t=>{
  const f=fixture(t);
  f.git(['checkout','--detach',f.baseSha]);
  const request=async url=>{
    const resource=url.split('/repos/hm2236/jamio-news')[1];
    if(resource==='/git/ref/heads/main')
      return new Response(JSON.stringify({object:{sha:f.baseSha}}));
    if(resource==='/pulls/91')
      return new Response(JSON.stringify({state:'open',
        head:{sha:f.headSha,repo:{full_name:'hm2236/jamio-news'}},base:{sha:f.baseSha}}));
    if(resource.startsWith('/git/ref/heads/daily/'))
      return new Response('not found',{status:404});
    if(resource.startsWith('/pulls?state=open&head='))
      return new Response('[]');
    if(resource.startsWith('/pulls?state=open&base=main'))
      return new Response(JSON.stringify([{number:92,head:{
        ref:'recovery/competing-packet',repo:{full_name:'hm2236/jamio-news'}
      }}]));
    if(resource==='/pulls/92/files?per_page=100')
      return new Response(JSON.stringify([{filename:f.file,status:'added'}]));
    throw new Error('Unexpected mock route: '+resource);
  };
  await assert.rejects(
    trustedPreview(f.root,f.event,f.output,{...f.options,request,now}),
    /Another recovery packet PR already exists/);
  assert.equal(fs.existsSync(f.output),false);
});

test('trusted workflow stays pinned to main, signs HTML/receipt and never checks out PR code',()=>{
  const y=fs.readFileSync(path.join(source,'.github/workflows/trusted-recovery-preview.yml'),'utf8');
  assert.match(y,/pull_request_target:/);
  assert.match(y,/pull-requests: read/);
  assert.match(y,/contents: read/);
  assert.match(y,/id-token: write/);
  assert.match(y,/attestations: write/);
  assert.match(y,/artifact-metadata: write/);
  assert.match(y,/persist-credentials: false/);
  assert.match(y,/base\.sha == github\.sha/);
  assert.match(y,/subject-path:[\s\S]*offline-review\.html[\s\S]*trusted-preview\.json/);
  assert.match(y,/uses: actions\/attest@[a-f0-9]{40}/);
  assert.doesNotMatch(y,/ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha/);
  assert.doesNotMatch(y,/actions\/checkout@v\d/);
  assert.doesNotMatch(y,/run:\s*[^\n]*\$\{\{\s*github\.event\.pull_request\.head/);
});

test('trusted preview incident reason codes never echo untrusted content',()=>{
  const cases=[
    [new Error('Trusted workflow identity mismatch'),'workflow-identity'],
    [new Error('Trusted read-only GitHub API token unavailable'),'auth-unavailable'],
    [new Error('Main changed after preview event'),'stale-main'],
    [new Error('Recovery PR identity changed after preview event'),'pr-moved'],
    [new Error('Another daily branch already exists'),'daily-collision'],
    [new Error('Stale date JST rollover'),'jst-clock'],
    [new Error('Trusted live GitHub API check unavailable'),'api-unavailable'],
    [new Error('Trusted preview packet must be a regular file'),'packet-rejected'],
    [new Error('unexpected payload https://secret.example/key?token=secret'),'preview-rejected']
  ];
  for(const [error,expected] of cases)assert.equal(classifyTrustedPreviewFailure(error),expected);
});
