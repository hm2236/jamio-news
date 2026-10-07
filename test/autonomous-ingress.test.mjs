import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {canonical,serialize,loadRepository,readDraft} from '../scripts/production.mjs';
import {createContext,fence,editionState,repositoryDigests,evaluateDraft,shadow,liveContext,githubJSON} from '../scripts/autonomous.mjs';
import {registry,approvedSource,digest,collectSources,fetchSource,readableText,discoveryLinks} from '../scripts/source-research.mjs';

const sourceRoot = fileURLToPath(new URL('../',import.meta.url));
const startedAt = '2026-10-07T06:00:00+09:00', now = new Date('2026-10-07T06:45:00+09:00');
const context = () => createContext({runId:123,attempt:1,createdAt:startedAt,baseSha:'a'.repeat(40),windowStart:'2026-10-06T07:00:00+09:00'});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'jamio-autonomous-'));
  t.after(()=>{
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe fixture cleanup');
    fs.rmSync(root,{recursive:true,force:true});
  });
  for (const name of ['content','data','site.config.json']) fs.cpSync(path.join(sourceRoot,name),path.join(root,name),{recursive:true});
  // Actual publication of the synthetic test date must not collide with this fixture.
  for (const dir of ['content/articles','content/editions']) for (const name of fs.readdirSync(path.join(root,dir))) {
    if (name.startsWith('2026-10-07-morning')) fs.rmSync(path.join(root,dir,name));
  }
  const ctx = context(), folder = path.join(root,'drafts',ctx.slug);
  fs.mkdirSync(path.join(folder,'articles'),{recursive:true});
  const snapshots = Array.from({length:5},(_,i)=>{
    const text = `October 7, 2026. This synthetic announcement ${i} is only a temporary test fixture. Official feature details describe the limitations and release conditions.`;
    return {url:`https://openai.com/index/shadow-fixture-${i}/`,finalUrl:`https://openai.com/index/shadow-fixture-${i}/`,sourceId:'openai',category:'ai',type:'official',checked:'2026-10-07T06:20:00+09:00',text,digest:digest(text),links:[]};
  });
  const stories = snapshots.map((s,i)=>({slug:`${ctx.slug}-fixture-${i}`,eventUrl:s.url,eventAt:'2026-10-07T05:30:00+09:00',eventDateText:'October 7, 2026',importance:`This temporary fixture ${i} has a concrete change to an existing workflow and enough relevance for editorial review.`,impact:`The effect in fixture ${i} should be evaluated against the user's current setup, release access and documented conditions.`,limitations:`The performance of fixture ${i} is not independently measured; broader availability and applicability remain unconfirmed.`,claims:[{kind:'fact',text:`Fixture ${i} has an official announcement of a feature and its documented release conditions.`,citations:[{url:s.url,excerpt:`This synthetic announcement ${i} is only a temporary test fixture.`}]},{kind:'inference',text:`Fixture ${i} may change how the reader plans a workflow; this is an editorial inference.`,citations:[{url:s.url,excerpt:'Official feature details describe the limitations and release conditions.'}]}]}));
  const articles = stories.map((s,i)=>({slug:s.slug,title:`Temporary fixture ${i}`,summary:'Synthetic summary only',category:'ai',tags:['fixture'],status:'verified',kind:'news',published:'2026-10-07T06:40:00+09:00',verificationNote:'Synthetic evidence for isolated tests only',sources:[{title:'Synthetic announcement',type:'official',url:s.eventUrl,checked:snapshots[i].checked}],body:`## 確認した事実\n\n[確認済み事実] ${s.claims[0].text}\n\n${s.importance}\n\n## じゃみおへの影響\n\n${s.impact}\n\n## 考察・未確定点\n\n[推論] ${s.claims[1].text}\n\n${s.limitations}\n\n## 出典と検証\n\nThe primary source is identified below. This test does not represent an actual news story, factual publication or permission to publish content. A real editor must compare every assertion, benchmark and condition with the actual primary material.\n` }));
  const slugs = articles.map(a=>a.slug);
  const edition = {slug:ctx.slug,date:ctx.date,variant:'morning',priceKeys:[],title:'Synthetic morning',kind:'daily',published:'2026-10-07T06:40:00+09:00',top5:slugs,hero:slugs[0],articles:slugs,deals:[],production:{contractVersion:1,x:{status:'unavailable',note:'Fixture: no authenticated X access; primary sources only'}},body:'Synthetic test edition only.\n'};
  const save = () => {
    fs.writeFileSync(path.join(folder,'edition.md'),serialize(edition));
    for (const article of articles) fs.writeFileSync(path.join(folder,'articles',article.slug+'.md'),serialize(article));
    fs.writeFileSync(path.join(folder,'prices.json'),'[]\n');
  };
  save();
  const report = {version:1,mode:'shadow',context:ctx,status:'awaiting-editorial',publicationAuthorized:false,existingDigests:repositoryDigests(loadRepository(root)),research:{snapshots,failures:[],x:{status:'unavailable',note:'Fixture only'}}};
  const evidence = {version:1,context:ctx,reportDigest:digest(canonical(report)),packageDigest:digest(canonical(readDraft(folder))),stories};
  const evaluate = () => {save(); evidence.packageDigest=digest(canonical(readDraft(folder))); evidence.reportDigest=digest(canonical(report)); return evaluateDraft(root,report,folder,evidence,ctx,now);};
  return {root,ctx,folder,report,evidence,articles,edition,save,evaluate};
}

import {inbox,parseSeal,parseChunk,eligibleEvent,prepareIngress,validateIngress,reconstruct,readCollectorReport,saveValidated,ingressJSON,rejectionReceipt} from '../scripts/autonomous-ingress.mjs';

function ingressFixture(t) {
  const f=fixture(t);
  execFileSync('git',['init','-q'],{cwd:f.root});
  execFileSync('git',['add','.'],{cwd:f.root});
  execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@invalid','commit','-qm','Isolated fixture'],{cwd:f.root});
  f.sha=execFileSync('git',['rev-parse','HEAD'],{cwd:f.root,encoding:'utf8'}).trim();
  f.ctx.baseSha=f.sha;
  const prior=loadRepository(f.root).editions.filter(e=>e.kind==='daily' && Date.parse(e.published)<Date.parse(startedAt)).sort((a,b)=>Date.parse(b.published)-Date.parse(a.published))[0];
  f.ctx.windowStart=prior?.published || '2026-10-06T06:00:00+09:00';
  f.attemptId='producer-attempt-0001';
  f.chunkBody=(file,payload,part=1,parts=1)=>inbox.chunkMarker+'\n'+JSON.stringify({version:1,attemptId:f.attemptId,file,part,parts})+'\n\n'+payload;
  f.metadata=(id,body)=>({id,body,user:{id:inbox.actorId},author_association:inbox.association,
    issue_url:'https://api.github.com/repos/'+inbox.repository+'/issues/'+inbox.issue,
    created_at:'2026-10-06T21:30:00Z',updated_at:'2026-10-06T21:30:00Z'});
  f.comments=new Map();
  f.articles.forEach((a,i)=>f.comments.set(String(10+i),f.metadata(10+i,f.chunkBody('articles/'+a.slug+'.md',serialize(a)))));
  f.comments.set('15',f.metadata(15,f.chunkBody('edition.md',serialize(f.edition))));
  f.comments.set('16',f.metadata(16,f.chunkBody('editorial.json',JSON.stringify({version:1,stories:f.evidence.stories}))));
  f.seal={version:1,attemptId:f.attemptId,date:f.ctx.date,slug:f.ctx.slug,variant:'morning',baseSha:f.sha,
    collectorRunId:'123',collectorRunAttempt:1,chunkCommentIds:[...f.comments.keys()]};
  const c=f.metadata(99,'');c.created_at=c.updated_at='2026-10-06T21:44:00Z';f.comments.set('99',c);
  f.event={action:'created',repository:{full_name:inbox.repository,default_branch:'main'},issue:{number:inbox.issue},sender:{id:inbox.actorId}};
  f.syncSeal=()=>{c.body=inbox.sealMarker+'\n'+JSON.stringify(f.seal);f.event.comment=structuredClone(c);};f.syncSeal();
  f.runtime={eventName:'issue_comment',runId:'900',runAttempt:1,sha:f.sha,ref:'refs/heads/main'};
  f.run={id:123,repository:{full_name:inbox.repository},path:inbox.collectorWorkflow,event:'schedule',head_branch:'main',head_sha:f.sha,
    status:'completed',conclusion:'success',run_attempt:1,created_at:'2026-10-06T21:00:00Z',run_started_at:'2026-10-06T21:00:00Z'};
  f.artifact={id:55,name:'morning-shadow-123-1',expired:false,size_in_bytes:1000,workflow_run:{id:123,head_sha:f.sha},created_at:'2026-10-06T21:25:00Z'};
  f.collector={id:55,name:f.artifact.name,runId:'123',runAttempt:1,baseSha:f.sha,sizeBytes:1000,createdAt:f.artifact.created_at};
  f.mainSha=f.sha;f.branch=null;f.prs=[];f.artifacts=[f.artifact];f.clock=now;f.calls=[];f.hooks=()=>{};
  f.get=async(endpoint,options)=>{
    f.calls.push(endpoint);f.hooks(endpoint,f.calls.filter(x=>x===endpoint).length);
    let value;
    if(endpoint==='/git/ref/heads/main')value={ref:'refs/heads/main',object:{type:'commit',sha:f.mainSha}};
    else if(endpoint==='/actions/runs/900')value={id:900,repository:{full_name:inbox.repository},path:inbox.workflow,event:'issue_comment',head_branch:'main',head_sha:f.sha,run_attempt:f.runtime.runAttempt};
    else if(endpoint==='/actions/runs/123')value=f.run;
    else if(endpoint.startsWith('/actions/runs/123/artifacts?'))value={artifacts:f.artifacts};
    else if(endpoint==='/issues/37')value={number:37,url:'https://api.github.com/repos/'+inbox.repository+'/issues/37'};
    else if(endpoint.startsWith('/issues/37/comments?')){
      const query=new URLSearchParams(endpoint.split('?')[1]),since=Date.parse(query.get('since'));
      assert.ok(Number.isFinite(since),'inbox scan must have a bounded since window');
      const rows=[...f.comments.values()].filter(c=>Date.parse(c.updated_at)>since).sort((a,b)=>a.id-b.id);
      const offset=(Number(query.get('page'))-1)*100;value=rows.slice(offset,offset+100);
    }
    else if(endpoint.startsWith('/issues/comments/')){
      value=f.comments.get(endpoint.split('/').at(-1));if(!value)throw new Error('Missing chunk comment');
    }else if(endpoint==='/git/ref/heads/daily/'+f.ctx.slug){assert.equal(options.allow404,true);value=f.branch;}
    else if(endpoint.startsWith('/pulls?'))value=f.prs;
    else throw new Error('Unexpected GET');
    return structuredClone(value);
  };
  f.options=()=>({get:f.get,now:()=>f.clock,expectedCollector:f.collector,loadReport:async()=>structuredClone(f.report)});
  f.validate=()=>validateIngress(f.root,f.event,f.runtime,f.options());
  f.prepare=()=>prepareIngress(f.root,f.event,f.runtime,f.options());
  return f;
}
function chunkHeader(f,index,change){
  const c=f.comments.get(String(index)),[marker,line,,...payload]=c.body.split('\n');
  c.body=marker+'\n'+JSON.stringify({...JSON.parse(line),...change})+'\n\n'+payload.join('\n');
}
function payload(f,index,value){
  const c=f.comments.get(String(index)),start=c.body.indexOf('\n\n');c.body=c.body.slice(0,start+2)+value;
}
test('valid ingress uses evaluateDraft, generates trusted digests and receipt, never changes repository',async t=>{
  const f=ingressFixture(t),before=repositoryDigests(loadRepository(f.root));
  assert.deepEqual(await f.prepare(),f.collector);const result=await f.validate();
  assert.equal(result.receipt.status,'validated');assert.equal(result.receipt.publicationAuthorized,false);
  assert.equal(result.receipt.reportDigest,digest(canonical(f.report)));
  const output=path.join(f.root,'validated');saveValidated(output,result);
  assert.equal(result.receipt.packageDigest,digest(canonical(readDraft(path.join(output,'draft',f.ctx.slug)))));
  assert.equal(result.receipt.editionDigest.length,64);assert.equal(result.receipt.validatedFiles.length,6);
  assert.equal(result.artifactName,'validated-package-99-900-1');
  assert.deepEqual(fs.readdirSync(output).sort(),['collector.json','draft','evidence.json','provenance.json','receipt.json']);
  const saved=name=>JSON.parse(fs.readFileSync(path.join(output,name+'.json'),'utf8'));
  assert.equal(result.receipt.evidenceDigest,digest(canonical(saved('evidence'))));
  assert.equal(result.receipt.provenanceDigest,digest(canonical(saved('provenance'))));
  assert.deepEqual(result.receipt.chunkCommentIds,f.seal.chunkCommentIds);
  assert.deepEqual(result.provenance.chunks.map(c=>String(c.id)),f.seal.chunkCommentIds);
  for(const comment of [result.provenance.seal,...result.provenance.chunks])
    assert.equal(comment.bodyDigest,digest(f.comments.get(String(comment.id)).body));
  assert.equal(result.receipt.sealBodyDigest,digest(result.provenance.seal.body));
  const altered=saved('evidence');altered.stories[0].impact+=' tampered';
  assert.notEqual(digest(canonical(altered)),result.receipt.evidenceDigest);
  assert.deepEqual(repositoryDigests(loadRepository(f.root)),before);
  assert.ok(!fs.existsSync(path.join(f.root,'content/editions',f.ctx.slug+'.md')));
  assert.throws(()=>saveValidated(output,result),/EEXIST/);
  fs.rmSync(output,{recursive:true});
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:f.root,encoding:'utf8'}),'');
});
for(const [name,change] of [
  ['wrong issue',f=>f.event.issue.number=38],['wrong repository',f=>f.event.repository.full_name='attacker/repo'],
  ['wrong default branch',f=>f.event.repository.default_branch='candidate'],
  ['wrong actor ID',f=>f.event.comment.user.id=1],['wrong sender',f=>f.event.sender.id=1],
  ['non-OWNER',f=>f.event.comment.author_association='MEMBER'],['PR comment',f=>f.event.issue.pull_request={}],
  ['non-seal chunk event',f=>f.event.comment.body=f.comments.get('10').body],
  ['edited event',f=>f.event.action='edited'],['other event',f=>f.runtime.eventName='workflow_dispatch']
])test(name+' skips before any API call',async t=>{
  const f=ingressFixture(t);change(f);assert.equal(eligibleEvent(f.event,f.runtime.eventName),false);
  await assert.rejects(f.validate,/Ineligible/);assert.equal(f.calls.length,0);
});
const rejected=[
  ['malformed JSON',f=>f.event.comment.body=inbox.sealMarker+'\n{'],
  ['unknown seal field',f=>{f.seal.reportDigest='a'.repeat(64);f.syncSeal();}],
  ['duplicate comment ID',f=>{f.seal.chunkCommentIds[1]='10';f.syncSeal();}],
  ['wrong slug',f=>{f.seal.slug='2026-10-07-noon';f.syncSeal();}],
  ['non-morning variant',f=>{f.seal.variant='evening';f.syncSeal();}],
  ['invalid date',f=>{f.seal.date='2026-02-30';f.syncSeal();}],
  ['returned comment ID mismatch',f=>f.comments.get('10').id=11],
  ['missing chunk',f=>f.comments.delete('10')],
  ['unknown chunk ID',f=>{f.seal.chunkCommentIds[0]='999';f.syncSeal();}],
  ['too many comments',f=>{f.seal.chunkCommentIds=Array.from({length:29},(_,i)=>String(i+1));f.syncSeal();}],
  ['mixed attempt IDs',f=>chunkHeader(f,10,{attemptId:'producer-attempt-0002'})],
  ['duplicate logical path',f=>chunkHeader(f,11,{file:'articles/'+f.articles[0].slug+'.md'})],
  ['missing part',f=>chunkHeader(f,10,{parts:2})],
  ['invalid part',f=>chunkHeader(f,10,{part:0})],['too many parts',f=>chunkHeader(f,10,{parts:5})],
  ['edited chunk',f=>f.comments.get('10').updated_at='2026-10-06T21:31:00Z'],
  ['edited seal',f=>{f.comments.get('99').updated_at='2026-10-06T21:45:00Z';f.event.comment=structuredClone(f.comments.get('99'));}],
  ['chunk after seal',f=>{f.comments.get('10').created_at=f.comments.get('10').updated_at='2026-10-06T21:45:00Z';}],
  ['chunk wrong inbox',f=>f.comments.get('10').issue_url='https://api.github.com/repos/hm2236/jamio-news/issues/38'],
  ['chunk wrong actor',f=>f.comments.get('10').user.id=1],['chunk non-OWNER',f=>f.comments.get('10').author_association='MEMBER'],
  ['seal differs from event',f=>f.comments.get('99').body+='\n'],
  ['second seal for attempt',f=>{const c=structuredClone(f.comments.get('99'));c.id=100;f.comments.set('100',c);}],
  ['forbidden repository path',f=>chunkHeader(f,10,{file:'content/articles/'+f.articles[0].slug+'.md'})],
  ['path traversal',f=>chunkHeader(f,10,{file:'articles/../../scripts/evil.mjs'})],
  ['backslash path',f=>chunkHeader(f,10,{file:'articles\\evil.md'})],
  ['price mutation',f=>chunkHeader(f,10,{file:'data/prices.json'})],
  ['candidate code',f=>chunkHeader(f,10,{file:'scripts/autonomous.mjs'})],
  ['candidate workflow',f=>chunkHeader(f,10,{file:'.github/workflows/evil.yml'})],
  ['oversized part',f=>payload(f,10,'あ'.repeat(8193))],
  ['invalid editorial structure',f=>payload(f,16,JSON.stringify({version:1,stories:[]}))],
  ['producer context prohibited',f=>payload(f,16,JSON.stringify({version:1,stories:f.evidence.stories,context:f.ctx}))],
  ['producer hash prohibited',f=>payload(f,16,JSON.stringify({version:1,stories:f.evidence.stories,packageDigest:'a'.repeat(64)}))],
  ['wrong collector workflow',f=>f.run.path='.github/workflows/pages.yml'],
  ['collector report wrong date',f=>{f.report.context.date='2026-10-06';}],
  ['wrong collector SHA',f=>f.run.head_sha='b'.repeat(40)],['wrong collector attempt',f=>f.run.run_attempt=2],
  ['failed collector',f=>f.run.conclusion='failure'],['unfinished collector',f=>f.run.status='in_progress'],
  ['wrong collector branch',f=>f.run.head_branch='candidate'],['wrong collector repository',f=>f.run.repository.full_name='attacker/repo'],
  ['wrong collector event',f=>f.run.event='pull_request'],['missing artifact',f=>f.artifacts=[]],
  ['expired artifact',f=>f.artifact.expired=true],['oversized artifact',f=>f.artifact.size_in_bytes=inbox.limits.artifactBytes+1],
  ['artifact wrong SHA',f=>f.artifact.workflow_run.head_sha='b'.repeat(40)],
  ['artifact from old attempt',f=>f.artifact.created_at='2026-10-06T20:00:00Z'],
  ['ambiguous artifact',f=>f.artifacts.push(structuredClone(f.artifact))],
  ['download reference mismatch',f=>f.collector.id=56],['report context mismatch',f=>f.report.context.attempt=2],
  ['report wrong mode',f=>f.report.mode='producer'],['report authorizes publication',f=>f.report.publicationAuthorized=true],
  ['bad source digest',f=>f.report.research.snapshots[0].digest='b'.repeat(64)],
  ['bad citation semantics',f=>{f.evidence.stories[0].claims[0].citations[0].excerpt='A statement absent from the collected source.';payload(f,16,JSON.stringify({version:1,stories:f.evidence.stories}));}],
  ['bad event timing',f=>{f.evidence.stories[0].eventAt='2026-10-05T00:00:00+09:00';payload(f,16,JSON.stringify({version:1,stories:f.evidence.stories}));}],
  ['unknown story field',f=>{f.evidence.stories[0].bypass=true;payload(f,16,JSON.stringify({version:1,stories:f.evidence.stories}));}],
  ['bad publishing schema',f=>{f.edition.top5.pop();payload(f,15,serialize(f.edition));}],
  ['existing edition digest changed',f=>f.report.existingDigests={}],
  ['existing edition collision',f=>fs.writeFileSync(path.join(f.root,'content/editions',f.ctx.slug+'.md'),serialize(f.edition))],
  ['daily branch conflict',f=>f.branch={object:{sha:f.sha}}],['daily PR conflict',f=>f.prs=[{number:14}]],
  ['partial existing article',f=>fs.writeFileSync(path.join(f.root,'content/articles',f.articles[0].slug+'.md'),serialize(f.articles[0]))],
  ['stale main',f=>f.mainSha='b'.repeat(40)],['wrong checkout/runtime',f=>f.runtime.sha='b'.repeat(40)],
  ['wrong JST date',f=>f.clock=new Date('2026-10-08T00:00:00+09:00')],
  ['collector older than two hours',f=>f.clock=new Date('2026-10-07T08:00:01+09:00')]
];
for(const [name,change] of rejected)test('rejects '+name,async t=>{
  const f=ingressFixture(t);change(f);await assert.rejects(f.validate);
});
test('compact LF headers reject duplicate keys, extra keys, prose, CRLF, seal payload and wrong separator',t=>{
  const f=ingressFixture(t),good=f.event.comment.body;
  for(const body of [good.replace('"version":1','"version":1,"version":1'),good.replace('"version":1','"version": 1'),
    good.replace('\n','\r\n'),'prose\n'+good,good+'\n\npayload'])assert.throws(()=>parseSeal(body));
  const chunk=f.comments.get('10').body;
  for(const body of [chunk.replace('"version":1','"version":1,"unknown":true'),chunk.replace('\n\n','\n'),
    chunk.replace('"version":1','"version":1,"version":1')])assert.throws(()=>parseChunk(body,f.seal));
  assert.deepEqual(parseSeal(good+'\n'),f.seal);
});
test('multipart supports shuffled parts and raw UTF-8/CRLF payload',async t=>{
  const f=ingressFixture(t),c=f.comments.get('10'),file=JSON.parse(c.body.split('\n')[1]).file,raw=c.body.slice(c.body.indexOf('\n\n')+2);
  const cut=Array.from(raw).slice(0,500).join('').length;c.body=f.chunkBody(file,raw.slice(0,cut),1,2);
  f.comments.set('17',f.metadata(17,f.chunkBody(file,raw.slice(cut),2,2)));
  f.seal.chunkCommentIds.splice(0,1,'17','10');f.syncSeal();
  assert.equal((await f.validate()).receipt.publicationAuthorized,false);
  const inert='line\r\n日本語\n$(ignored); shell-looking text';
  assert.equal(parseChunk(f.chunkBody(file,inert),f.seal).payload,inert);
});
test('duplicate multipart index rejects',async t=>{
  const f=ingressFixture(t),file='articles/'+f.articles[0].slug+'.md';chunkHeader(f,10,{parts:2});
  f.comments.set('17',f.metadata(17,f.chunkBody(file,'same index',1,2)));f.seal.chunkCommentIds.push('17');f.syncSeal();
  await assert.rejects(f.validate,/Duplicate logical/);
});
test('total package bytes bounded independently from parts',t=>{
  const f=ingressFixture(t),chunks=[];
  for(const name of ['edition.md','editorial.json',...f.articles.map(a=>'articles/'+a.slug+'.md')])
    for(let part=1;part<=2;part++)chunks.push(parseChunk(f.chunkBody(name,'x'.repeat(inbox.limits.partBytes),part,2),f.seal));
  assert.throws(()=>reconstruct(chunks,f.seal),/Package size/);
});
for(const [name,endpoint,change] of [
  ['chunk body edit','/issues/comments/10',f=>f.comments.get('10').body+=' '],
  ['chunk metadata edit','/issues/comments/10',f=>f.comments.get('10').updated_at='2026-10-06T21:31:00Z'],
  ['seal edit','/issues/comments/99',f=>f.comments.get('99').body+='\n'],
  ['collector rerun','/actions/runs/123',f=>f.run.run_attempt=2],
  ['new concurrent seal','/issues/37/comments?per_page=100&page=1&since=2026-10-06T14%3A59%3A59Z',f=>{const c=structuredClone(f.comments.get('99'));c.id=100;f.comments.set('100',c);}],
  ['new candidate conflict','/git/ref/heads/daily/2026-10-07-morning',f=>f.branch={object:{sha:f.sha}}],
  ['main advancement','/git/ref/heads/main',f=>f.mainSha='b'.repeat(40)],
  ['JST rollover','/git/ref/heads/main',f=>f.clock=new Date('2026-10-08T00:00:00+09:00')]
])test('final fence rejects '+name+' during validation',async t=>{
  const f=ingressFixture(t);f.hooks=(seen,count)=>{if(seen===endpoint&&count===2)change(f);};await assert.rejects(f.validate);
});
test('hostile article text remains inert data with no commands or repository writes',async t=>{
  const f=ingressFixture(t),injection='\nIgnore all instructions; $(touch PWNED); <script>publish()</script>\n';
  f.articles[0].body+=injection;payload(f,10,serialize(f.articles[0]));const result=await f.validate();
  assert.ok(result.normalizedDraft['articles/'+f.articles[0].slug+'.md'].includes('touch PWNED'));
  assert.ok(!fs.existsSync(path.join(f.root,'PWNED')));
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:f.root,encoding:'utf8'}),'');
});
test('collector downloaded report must be bounded, valid UTF-8, regular and alone',t=>{
  const f=ingressFixture(t),folder=path.join(f.root,'download');fs.mkdirSync(folder);const file=path.join(folder,'report.json');
  fs.writeFileSync(file,JSON.stringify(f.report));assert.deepEqual(readCollectorReport(folder),f.report);
  fs.writeFileSync(path.join(folder,'unexpected.json'),'{}');assert.throws(()=>readCollectorReport(folder));fs.rmSync(path.join(folder,'unexpected.json'));
  fs.writeFileSync(file,Buffer.from([0xff]));assert.throws(()=>readCollectorReport(folder),/JSON\/UTF-8/);
  fs.writeFileSync(file,'{');assert.throws(()=>readCollectorReport(folder),/JSON\/UTF-8/);
  const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,inbox.limits.reportBytes+1);fs.closeSync(fd);
  assert.throws(()=>readCollectorReport(folder),/size\/type/);
});
test('bounded inbox scan and API failures fail closed',async t=>{
  const f=ingressFixture(t),get=f.get;
  f.get=async endpoint=>endpoint.startsWith('/issues/37/comments?')?Array.from({length:100},()=>f.comments.get('10')):get(endpoint);
  await assert.rejects(f.validate,/scan limit/);f.get=async()=>{throw new Error('Network unavailable');};await assert.rejects(f.validate,/Network/);
});
test('workflow is trusted-main, seal gated, queued, downloads collector independently and contains no write credentials',()=>{
  const workflow=fs.readFileSync(path.join(sourceRoot,inbox.workflow),'utf8').replace(/\r\n/g,'\n');
  for(const value of [inbox.repository,inbox.issue,inbox.actorId,inbox.association,inbox.sealMarker])assert.ok(workflow.includes(String(value)));
  assert.match(workflow,/issue_comment:\n\s+types: \[created\]/);assert.match(workflow,/!github\.event\.issue\.pull_request/);
  assert.match(workflow,/queue: max/);assert.doesNotMatch(workflow,/cancel-in-progress/);
  assert.match(workflow,/ref: \$\{\{ github.sha \}\}/);assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/actions\/download-artifact@v4/);assert.match(workflow,/artifact-ids:/);
  assert.match(workflow,/overwrite: false/);assert.match(workflow,/retention-days: 14/);
  assert.doesNotMatch(workflow,/\bwrite\b|secrets\.|git push|gh pr|deploy-pages|workflow_dispatch:/);
  assert.doesNotMatch(workflow.slice(0,workflow.indexOf('jobs:')),/concurrency:/);
  assert.match(workflow,/    concurrency:\n      group: autonomous-package-inbox\n      queue: max/);
  assert.ok(workflow.indexOf('    if:')<workflow.indexOf('    concurrency:'));
  assert.ok(workflow.includes('fromJSON(\'"\\r\\n"\')'));
  const permissions=workflow.slice(workflow.indexOf('permissions:'),workflow.indexOf('jobs:'));
  assert.deepEqual([...permissions.matchAll(/^\s+([\w-]+): read/gm)].map(m=>m[1]).sort(),['actions','contents','issues','pull-requests']);
  const source=fs.readFileSync(path.join(sourceRoot,'scripts/autonomous-ingress.mjs'),'utf8');
  assert.doesNotMatch(source,/eval\(|execSync\(|applyDraft\(/);
});

test('GitHub fence reads are explicit uncached repository GETs with no redirects or write method',async()=>{
  await ingressJSON('/git/ref/heads/main',{request:async(url,options)=>{
    assert.equal(url,'https://api.github.com/repos/hm2236/jamio-news/git/ref/heads/main');
    assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.method,undefined);
    assert.ok(options.signal);return new Response('{}');
  }});
});
test('CLI rejection emits one sanitized receipt and never logs payload/token or saves output',t=>{
  const f=ingressFixture(t),eventFile=path.join(f.root,'event.json'),output=path.join(f.root,'rejected');
  f.event.comment.body='hostile-private-payload';fs.writeFileSync(eventFile,JSON.stringify(f.event));
  const result=spawnSync(process.execPath,[path.join(sourceRoot,'scripts/autonomous-ingress.mjs'),'prepare',output],{
    cwd:sourceRoot,encoding:'utf8',env:{...process.env,GITHUB_EVENT_PATH:eventFile,GITHUB_EVENT_NAME:'issue_comment',
      GITHUB_REPOSITORY:inbox.repository,GITHUB_RUN_ID:'900',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:f.sha,GITHUB_REF:'refs/heads/main',GITHUB_TOKEN:'never-log-this-fixture-token'}
  });
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.ok(!fs.existsSync(output));
  assert.equal(result.stderr.trim().split('\n').length,1);
  assert.match(result.stderr,/JAMIO_PACKAGE_INGRESS /);assert.doesNotMatch(result.stderr,/hostile-private-payload|never-log-this-fixture-token/);
  const receipt=JSON.parse(result.stderr.slice('JAMIO_PACKAGE_INGRESS '.length));
  assert.equal(receipt.status,'rejected');assert.equal(receipt.publicationAuthorized,false);
});

test('strict ASCII identities and paths reject final newlines; UTF-8 rejects NUL and unpaired surrogates',t=>{
  const f=ingressFixture(t);
  for(const change of [{attemptId:f.attemptId+'\n'},{baseSha:f.sha+'\n'},{collectorRunId:'123\n'},
    {chunkCommentIds:['10\n',...f.seal.chunkCommentIds.slice(1)]}])
    assert.throws(()=>parseSeal(inbox.sealMarker+'\n'+JSON.stringify({...f.seal,...change})));
  const file='articles/'+f.articles[0].slug+'.md';
  assert.throws(()=>parseChunk(f.chunkBody(file+'\n','payload'),f.seal),/Forbidden/);
  for(const text of ['nul\0byte','unpaired\uD800'])assert.throws(()=>parseChunk(f.chunkBody(file,text),f.seal),/UTF-8/);
});

test('retained multi-year inbox history does not consume the active-day scan budget',async t=>{
  const f=ingressFixture(t);
  for(let i=1000;i<5000;i++){
    const c=f.metadata(i,'historical comment');c.created_at=c.updated_at='2026-10-05T00:00:00Z';
    f.comments.set(String(i),c);
  }
  const result=await f.validate();assert.equal(result.receipt.status,'validated');
  const scans=f.calls.filter(e=>e.startsWith('/issues/37/comments?'));
  assert.equal(scans.length,2);assert.ok(scans.every(e=>e.endsWith('&since=2026-10-06T14%3A59%3A59Z')));
  assert.equal(result.provenance.scanWindow.createdFrom,'2026-10-06T15:00:00Z');
});

test('active-window pagination still checks a duplicate seal on a later page',async t=>{
  const f=ingressFixture(t);
  for(let i=1000;i<1200;i++)f.comments.set(String(i),{...f.metadata(i,'unrelated'),user:{id:1}});
  const c=structuredClone(f.comments.get('99'));c.id=2000;f.comments.set('2000',c);
  await assert.rejects(f.validate,/Multiple or missing seals/);
  assert.ok(f.calls.some(e=>e.includes('page=3&since=')));
});

for(const phase of ['initial','final'])for(const shape of ['valid','edited','invalid header fields'])
  test(phase+' scan rejects '+shape+' unreferenced same-attempt chunk',async t=>{
    const f=ingressFixture(t);
    const add=()=>{
      const c=f.metadata(100,f.chunkBody('edition.md','conflicting payload'));
      if(shape==='edited')c.updated_at='2026-10-06T21:44:01Z';
      if(shape==='invalid header fields')c.body=c.body.replace('"part":1','"part":0');
      f.comments.set('100',c);
    };
    if(phase==='initial')add();
    else f.hooks=(endpoint,count)=>{if(endpoint.startsWith('/issues/37/comments?')&&count===2)add();};
    await assert.rejects(f.validate,error=>rejectionReceipt(error).code==='unreferenced-attempt-chunk');
  });

test('unrelated attempts and unauthorized unreferenced chunks do not collide',async t=>{
  const f=ingressFixture(t);
  f.comments.set('100',f.metadata(100,f.chunkBody('edition.md','other attempt').replace(f.attemptId,'producer-attempt-0002')));
  f.comments.set('101',{...f.metadata(101,f.chunkBody('edition.md','untrusted')),user:{id:1}});
  assert.equal((await f.validate()).receipt.status,'validated');
});

test('day-bound references reject old chunks and seals, including the since boundary second',async t=>{
  const f=ingressFixture(t),c=f.comments.get('10');
  c.created_at=c.updated_at='2026-10-06T14:59:59Z';
  await assert.rejects(f.validate,error=>rejectionReceipt(error).code==='comment-window-mismatch');
  c.created_at=c.updated_at='2026-10-06T15:00:00Z';
  assert.equal((await f.validate()).receipt.status,'validated');
  f.comments.get('99').created_at=f.comments.get('99').updated_at='2026-10-06T14:59:59Z';f.syncSeal();
  await assert.rejects(f.validate,error=>rejectionReceipt(error).code==='comment-window-mismatch');
});

test('an old same-attempt chunk edited into the active window is observable and rejected',async t=>{
  const f=ingressFixture(t),c=f.metadata(100,f.chunkBody('edition.md','old conflict'));
  c.created_at='2026-10-05T00:00:00Z';c.updated_at='2026-10-06T21:40:00Z';f.comments.set('100',c);
  await assert.rejects(f.validate,/Unreferenced chunk/);
});

test('replays and multiple attempts are explicit independent shadow observations without a winner',async t=>{
  const f=ingressFixture(t),first=await f.validate();f.runtime.runAttempt=2;
  const replay=await f.validate();assert.equal(replay.receipt.packageDigest,first.receipt.packageDigest);
  assert.notEqual(replay.artifactName,first.artifactName);
  assert.deepEqual(replay.receipt.validationPolicy,{version:1,attemptScope:'jst-date',
    replay:'independent-shadow-validation',multiAttempt:'independent-shadow-validation',selection:'none',exactlyOnce:false});
  const old=structuredClone(f.comments.get('99'));old.id=98;f.comments.set('98',old);
  for(const commentId of f.seal.chunkCommentIds){
    const c=f.comments.get(commentId);c.body=c.body.replace(f.attemptId,'producer-attempt-0002');
  }
  f.attemptId=f.seal.attemptId='producer-attempt-0002';f.syncSeal();
  // The first immutable artifact remains independent; no supersession is claimed.
  f.articles[0].body+='\nA different shadow observation.\n';payload(f,10,serialize(f.articles[0]));
  const other=await f.validate();assert.notEqual(other.receipt.packageDigest,first.receipt.packageDigest);
  assert.equal(other.receipt.validationPolicy.selection,'none');assert.equal(other.receipt.publicationAuthorized,false);
});

test('CRLF and marker-only seals route to sanitized rejection instead of silently skipping',async t=>{
  const f=ingressFixture(t);
  for(const body of [f.event.comment.body.replace(/\n/g,'\r\n'),inbox.sealMarker]){
    f.event.comment.body=body;assert.equal(eligibleEvent(f.event,f.runtime.eventName),true);
    await assert.rejects(f.validate,/Malformed marker/);assert.equal(f.calls.length,0);
  }
});

test('evaluator diagnostics distinguish semantic rejection without printing source or payload',async t=>{
  const f=ingressFixture(t);f.evidence.stories[0].claims[0].citations[0].excerpt='secret-source-not-in-report';
  payload(f,16,JSON.stringify({version:1,stories:f.evidence.stories}));
  await assert.rejects(f.validate,error=>{
    const receipt=rejectionReceipt(error);assert.equal(receipt.code,'evidence-invalid');
    assert.doesNotMatch(JSON.stringify(receipt),/secret-source/);return true;
  });
  const receipt=rejectionReceipt(new Error('credential-secret host/path raw-payload'));
  assert.equal(receipt.code,'validation-or-read-failed');assert.doesNotMatch(JSON.stringify(receipt),/credential-secret|raw-payload|host\/path/);
});

test('the final receipt timestamp itself is fenced at expiry',async t=>{
  const f=ingressFixture(t),options=f.options();let reads=0;
  options.now=()=>new Date(++reads<6?'2026-10-07T07:59:59+09:00':'2026-10-07T08:00:01+09:00');
  await assert.rejects(()=>validateIngress(f.root,f.event,f.runtime,options),error=>{
    assert.equal(rejectionReceipt(error).code,'stale-context');return true;
  });assert.equal(reads,6);
});

for(const phase of ['initial','final'])test(phase+' scan rejects a malformed competing same-attempt seal claim',async t=>{
  const f=ingressFixture(t),add=()=>{
    const c=f.metadata(100,inbox.sealMarker+'\r\n'+JSON.stringify({...f.seal,extra:true}));f.comments.set('100',c);
  };
  if(phase==='initial')add();
  else f.hooks=(endpoint,count)=>{if(endpoint.startsWith('/issues/37/comments?')&&count===2)add();};
  await assert.rejects(f.validate,/Multiple or missing seals/);
});

test('collector expiry has a sanitized stale-context diagnostic',async t=>{
  const f=ingressFixture(t);f.clock=new Date('2026-10-07T08:00:01+09:00');
  await assert.rejects(f.validate,error=>{
    const receipt=rejectionReceipt(error);assert.equal(receipt.code,'stale-context');
    assert.equal(receipt.reason,'Collector context or lifetime rejected');return true;
  });
});
