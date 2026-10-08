import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {previewPackage, MAX_PACKET_BYTES} from '../scripts/recovery-preview.mjs';
import {loadRepository, canonical, editionDigest} from '../scripts/production.mjs';
import {recoveryStatus} from '../scripts/recovery-status.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const date = '2026-10-09', clock = () => new Date(date+'T18:00:00+09:00');
function fixture(t, variant = 'morning', count = variant === 'morning' ? 5 : 1) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(),'jamio-recovery-test-'));
  t.after(() => fs.rmSync(parent,{recursive:true,force:true}));
  const root = path.join(parent,'checkout'); fs.mkdirSync(root);
  for (const name of ['content','data','docs','public','scripts','contracts','config','site.config.json'])
    fs.cpSync(path.join(source,name),path.join(root,name),{recursive:true});
  const git = args => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
  git(['init']); git(['add','.']);
  git(['-c','user.name=Recovery fixture','-c','user.email=fixture@example.test','commit','-m','Synthetic fixture base']);
  const baseSha=git(['rev-parse','HEAD']), slug=date+'-'+variant;
  const articles=Array.from({length:count},(_,i)=>({slug:slug+'-fixture-'+i,title:'Synthetic recovery '+i,
    summary:'Synthetic fixture, never published',category:'ai',tags:['fixture'],status:'verified',kind:'news',
    published:date+'T17:00:00+09:00',verificationNote:'Synthetic fixture only; no factual claim of live verification',
    sources:[{title:'Synthetic source',type:'official',url:'https://fixture.example.jp/event/'+i,checked:date+'T16:00:00+09:00'}],
    body:'\nSynthetic fixture only.\n'}));
  const slugs=articles.map(a=>a.slug);
  const edition={slug,date,variant,priceKeys:[],title:'Synthetic recovery edition',kind:'daily',
    published:date+'T17:00:00+09:00',top5:slugs.slice(),hero:slugs[0],articles:slugs,deals:[],
    production:{contractVersion:1,x:{status:'unavailable',note:'Synthetic fixture: X unavailable'}},body:'\nSynthetic edition only.\n'};
  const packet={version:1,baseSha,package:{date,edition,articles,priceObservations:[]}};
  return {root,parent,git,baseSha,packet,output:path.join(parent,'preview'),
    options:{expectedBaseSha:baseSha,now:clock}};
}
function trackedBytes(f) { return f.git(['ls-files']).split('\n').map(p=>[p,fs.readFileSync(path.join(f.root,p)).toString('base64')]); }
test('morning 5 and evening 1-5 render previews through actual daily validation and build, preserving all source bytes',t=>{
  for(const [variant,count] of [['morning',5],...Array.from({length:5},(_,i)=>['evening',i+1])]){
    const f=fixture(t,variant,count), before=trackedBytes(f), repo=loadRepository(f.root);
    const result=previewPackage(f.root,f.packet,f.output,f.options);
    assert.equal(result.status,'preview-ready');assert.equal(result.publicationAuthorized,false);assert.equal(result.editorialReviewRequired,true);
    assert.equal(result.variant,variant);assert.equal(result.files.length,count+1);
    const manifest=JSON.parse(fs.readFileSync(path.join(f.output,'site/publication.json'),'utf8'));
    for(const e of repo.editions)assert.equal(manifest.editions.find(p=>p.slug===e.slug).digest,editionDigest(e,repo.articles,repo.prices));
    assert.equal(manifest.editions.find(p=>p.slug===result.slug).digest,result.digest);
    assert.ok(fs.readFileSync(path.join(f.output,'site/editions',result.slug,'index.html'),'utf8').includes(result.digest));
    const files=JSON.parse(fs.readFileSync(path.join(f.output,'candidate-files.json'),'utf8'));
    assert.equal(files.at(-1).file,'content/editions/'+result.slug+'.md');
    assert.deepEqual(trackedBytes(f),before);assert.equal(f.git(['status','--porcelain']),'');
    assert.throws(()=>previewPackage(f.root,f.packet,f.output,f.options),/already exists/);
  }
});
test('invalid package, stale date/base, future timestamp and variant size cannot produce output',t=>{
  const mutations=[
    p=>p.baseSha='0'.repeat(40),
    p=>p.unexpected=true,
    p=>p.package.articles[0].body='',
    p=>p.package.articles[0].slug='../escape',
    p=>p.package.edition.variant='noon',
    p=>p.package.edition.top5.pop(),
    p=>p.package.articles[0].published=date+'T23:00:00+09:00',
    p=>p.package.articles[0].sources[0].checked=date+'T23:00:00+09:00',
    p=>p.package.articles[0].body='x'.repeat(MAX_PACKET_BYTES)
  ];
  for(const mutate of mutations){
    const f=fixture(t);mutate(f.packet);assert.throws(()=>previewPackage(f.root,f.packet,f.output,f.options));
    assert.equal(fs.existsSync(f.output),false);assert.equal(f.git(['status','--porcelain']),'');
  }
  for(const count of [0,6]) {const f=fixture(t,'evening',count);assert.throws(()=>previewPackage(f.root,f.packet,f.output,f.options));assert.equal(fs.existsSync(f.output),false);}
  const f=fixture(t);
  assert.throws(()=>previewPackage(f.root,f.packet,f.output,{...f.options,now:()=>new Date('2026-10-10T00:00:00+09:00')}),/Stale/);
  assert.throws(()=>previewPackage(f.root,f.packet,f.output,{...f.options,expectedBaseSha:'0'.repeat(40)}),/Checkout/);
});
test('final JST rollover rejects preview without retained output',t=>{
  const f=fixture(t);let calls=0;
  assert.throws(()=>previewPackage(f.root,f.packet,f.output,{...f.options,now:()=>++calls===1?clock():new Date('2026-10-10T00:00:00+09:00')}),/Stale/);
  assert.equal(fs.existsSync(f.output),false);
  assert.throws(()=>previewPackage(f.root,f.packet,path.join(f.root,'unsafe'),f.options),/outside/);
});
test('same edition collisions are refused and never treated as re-publication',t=>{
  const f=fixture(t),published=loadRepository(f.root),e=published.editions.find(e=>e.variant==='evening');
  f.packet.package={date:e.date,edition:e,articles:published.articles.filter(a=>e.articles.includes(a.slug)),priceObservations:[]};
  assert.throws(()=>previewPackage(f.root,f.packet,f.output,{...f.options,now:()=>new Date(e.published)}),/already exists|must add/);
  assert.equal(fs.existsSync(f.output),false);assert.equal(f.git(['status','--porcelain']),'');
});
test('live status proves both explicit editions against exact SHA and distinguishes missing morning from optional evening',async t=>{
  const f=fixture(t);
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:f.root,env:{...process.env,GITHUB_SHA:f.baseSha},stdio:'pipe'});
  const manifest=JSON.parse(fs.readFileSync(path.join(f.root,'dist/publication.json'),'utf8'));
  let main=f.baseSha,mutateHTML=false;
  const request=async url=>{
    if(url.endsWith('/git/ref/heads/main'))return new Response(JSON.stringify({object:{sha:main}}));
    if(url.includes('api.github.com'))return new Response(JSON.stringify({workflow_runs:[{id:1,head_sha:f.baseSha,head_branch:'main',event:'push',status:'completed',conclusion:'success',html_url:'https://github.com/hm2236/jamio-news/actions/runs/1'}]}));
    if(url.includes('publication.json'))return new Response(JSON.stringify(manifest));
    const slug=new URL(url).pathname.split('/').filter(Boolean).at(-1);
    return new Response(mutateHTML?'<html>stale</html>':fs.readFileSync(path.join(f.root,'dist/editions',slug,'index.html'),'utf8'));
  };
  const result=await recoveryStatus(f.root,{request,now:clock});
  assert.deepEqual(result.latestConfirmed.map(p=>p.variant),['morning','evening']);
  assert.equal(result.today.morning,'missing');assert.equal(result.today.evening,'editorial-decision-required');assert.equal(result.schedulerState,'not-inspected');
  main='0'.repeat(40);await assert.rejects(recoveryStatus(f.root,{request,now:clock}),/exact current main/);
  main=f.baseSha;mutateHTML=true;await assert.rejects(recoveryStatus(f.root,{request,now:clock}),/HTML/);
  mutateHTML=false;manifest.commit='0'.repeat(40);await assert.rejects(recoveryStatus(f.root,{request,now:clock}),/manifest/);
});
