import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {previewPackage, MAX_PACKET_BYTES, previewBuildEnvironment} from '../scripts/recovery-preview.mjs';
import {createOfflineReview} from '../scripts/recovery-offline-review.mjs';
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
test('preview builder cannot inherit API, OIDC, Node injection or deployment configuration',()=>{
  const baseSha='a'.repeat(40);
  const env=previewBuildEnvironment({Path:'platform-path',SystemRoot:'platform-root',TEMP:'platform-temp',
    GITHUB_SHA:'wrong',GITHUB_TOKEN:'secret',GH_TOKEN:'secret',ARBITRARY_SECRET:'secret',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN:'secret',ACTIONS_ID_TOKEN_REQUEST_URL:'https://token.example',
    NODE_OPTIONS:'--import ./attacker.mjs',NODE_PATH:'attacker',SITE_URL:'https://attacker.example'},baseSha);
  assert.deepEqual(env,{Path:'platform-path',SystemRoot:'platform-root',TEMP:'platform-temp',GITHUB_SHA:baseSha});
  const childEnv=previewBuildEnvironment({...process.env,
    GITHUB_TOKEN:'fixture-secret',GH_TOKEN:'fixture-secret',ARBITRARY_SECRET:'fixture-secret',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture-secret',ACTIONS_ID_TOKEN_REQUEST_URL:'https://token.example',
    NODE_OPTIONS:'--import ./attacker.mjs',NODE_PATH:'attacker',SITE_URL:'https://attacker.example'},baseSha);
  const child=execFileSync(process.execPath,['-e','process.stdout.write(JSON.stringify(process.env))'],{env:childEnv,encoding:'utf8'});
  const inherited=JSON.parse(child);
  for(const key of ['GITHUB_TOKEN','GH_TOKEN','ARBITRARY_SECRET','ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    'ACTIONS_ID_TOKEN_REQUEST_URL','NODE_OPTIONS','NODE_PATH','SITE_URL'])assert.equal(inherited[key],undefined);
  assert.equal(inherited.GITHUB_SHA,baseSha);
});
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
    const offline=createOfflineReview(f.output);
    assert.equal(offline.status,'offline-review-ready');
    assert.equal(offline.publicationAuthorized,false);
    assert.equal(offline.editorialReviewRequired,true);
    assert.equal(offline.baseSha,f.baseSha);
    assert.equal(offline.digest,result.digest);
    assert.equal(offline.articles,count);
    const view=fs.readFileSync(path.join(f.output,'offline-review.html'),'utf8');
    assert.ok(view.includes('<style>'));
    assert.ok(view.includes('未公開・編集確認用'));
    assert.ok(view.includes('href="#review-'+f.packet.package.articles[0].slug+'"'));
    assert.ok(view.includes('id="review-'+f.packet.package.articles[0].slug+'"'));
    assert.ok(view.includes('Synthetic recovery 0'));
    assert.doesNotMatch(view,/<script\b|<link\b|href="\/jamio-news\//);
    assert.throws(()=>createOfflineReview(f.output),/EEXIST/);
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

test('offline newspaper preserves literal dollar replacement tokens from original article HTML',t=>{
  const f=fixture(t,'evening',1);
  const markers=['DOLLAR_A$$B','AMP_C$&D','TICK_E$`F',"APOST_G$'H"];
  f.packet.package.articles[0].body='\n# Literal replacement tokens\n\n'+markers.join('\n\n')+'\n';
  previewPackage(f.root,f.packet,f.output,f.options);
  const slug=f.packet.package.articles[0].slug;
  const site=fs.readFileSync(path.join(f.output,'site/articles',slug,'index.html'),'utf8');
  createOfflineReview(f.output);
  const offline=fs.readFileSync(path.join(f.output,'offline-review.html'),'utf8');
  const expected=['DOLLAR_A$$B','AMP_C$&amp;D','TICK_E$`F','APOST_G$&#39;H'];
  for(const s of expected){
    assert.ok(site.includes(s),'published renderer lost '+s);
    assert.ok(offline.includes(s),'offline renderer altered '+s);
    assert.equal(offline.split(s).length-1,1,'offline inserted/duplicated '+s);
  }
  assert.equal((offline.match(/<main id="main">/g)||[]).length,1);
  assert.equal((offline.match(/<\/main>/g)||[]).length,1);
});

test('offline review refuses forged publication status and manifest mismatches',t=>{
  const f=fixture(t,'evening',1);
  previewPackage(f.root,f.packet,f.output,f.options);
  const receiptFile=path.join(f.output,'preview.json');
  const original=fs.readFileSync(receiptFile,'utf8');
  const bad=JSON.parse(original);
  bad.publicationAuthorized=true;
  fs.writeFileSync(receiptFile,JSON.stringify(bad));
  assert.throws(()=>createOfflineReview(f.output),/unpublished/);
  assert.equal(fs.existsSync(path.join(f.output,'offline-review.html')),false);
  fs.writeFileSync(receiptFile,original);
  const manifestFile=path.join(f.output,'site/publication.json');
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  manifest.commit='0'.repeat(40);
  fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  assert.throws(()=>createOfflineReview(f.output),/manifest/);
  assert.equal(fs.existsSync(path.join(f.output,'offline-review.html')),false);
});
