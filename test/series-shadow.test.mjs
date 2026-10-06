import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {canonical, serialize, readDraft, loadRepository} from '../scripts/production.mjs';
import {createContext, repositoryDigests} from '../scripts/autonomous.mjs';
import {digest} from '../scripts/source-research.mjs';
import {createSeriesInput, proposalBinding, evaluateSeriesProposals, hash, humanMetrics, originalCreatedAt, failureMetrics} from '../scripts/series-proposal.mjs';
import {aggregateSeries} from '../scripts/series-evaluation.mjs';
import {saveDetached, shadowSummary, historicalReplay, windowRuns} from '../scripts/series-shadow.mjs';

const sourceRoot = fileURLToPath(new URL('../',import.meta.url));
const now = new Date('2026-10-08T06:45:00+09:00');
function fixture(t, {date='2026-10-08', status='active', empty=false, tracking='campaign'}={}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'jamio-series-shadow-'));
  t.after(() => { if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe cleanup'); fs.rmSync(root,{recursive:true,force:true}); });
  for (const file of ['site.config.json','config/research-sources.json']) {fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(sourceRoot,file),path.join(root,file));}
  for (const folder of ['content/articles','content/editions','data/series']) fs.mkdirSync(path.join(root,folder),{recursive:true});
  fs.writeFileSync(path.join(root,'data/prices.json'),'[]\n');
  const ctx=createContext({runId:123,attempt:1,createdAt:date+'T06:00:00+09:00',baseSha:'a'.repeat(40),windowStart:'2026-10-07T07:00:00+09:00'});
  const trackKey={campaign:'campaign-fixture',incident:'incident-A',product:'product-A'}[tracking];
  const identity={canonicalTopic:{key:'campaign-fixture',scope:'scope-synthetic'},entities:[{type:tracking,key:trackKey,label:'Synthetic tracking object'}],region:'JP',productVersion:tracking==='product'?'v1':'',incidentId:tracking==='incident'?'incident-A':'',campaignId:tracking==='campaign'?'campaign-fixture':''};
  const identityText=[identity.canonicalTopic.key,identity.canonicalTopic.scope,identity.region,trackKey,identity.productVersion,identity.incidentId,identity.campaignId].filter(Boolean).join(' ');
  const previousClaim=identityText+'. The prior published claim states the outage began and recovery is pending.';
  const article=(slug,index,published,url,body)=>({slug,title:`Synthetic story ${index}`,summary:'Synthetic isolated test',category:'ai',tags:['fixture'],kind:'news',status:'verified',published,verificationNote:'Synthetic primary material, isolated test only',sources:[{title:'Synthetic primary',type:'official',url,checked:published.replace('06:40','06:20')}],body});
  const edition=(slug,articles,published)=>({slug,date:slug.slice(0,10),variant:'morning',priceKeys:[],title:'Synthetic morning',kind:'daily',published,top5:articles.map(a=>a.slug),hero:articles[0].slug,articles:articles.map(a=>a.slug),deals:[],production:{contractVersion:1,x:{status:'unavailable',note:'No authenticated X, synthetic fixture only'}},body:'Synthetic edition only.\n'});
  const prior=Array.from({length:5},(_,i)=>article(`2026-10-07-morning-prior-${i}`,i,'2026-10-07T07:00:00+09:00',`https://openai.com/index/series-prior-${i}/`,previousClaim+` Prior story ${i}.\n`));
  for(const a of prior)fs.writeFileSync(path.join(root,'content/articles',a.slug+'.md'),serialize(a));
  fs.writeFileSync(path.join(root,'content/editions/2026-10-07-morning.md'),serialize(edition('2026-10-07-morning',prior,prior[0].published)));
  const series={version:1,id:'campaign-fixture',title:'Synthetic campaign',canonicalTopic:identity.canonicalTopic,entities:identity.entities,status,expectedCount:28,coverage:{mode:'partial',note:'Synthetic test only'},revision:1,updatedAt:'2026-10-07T07:10:00+09:00',changeNote:'Synthetic reviewed registry',...(status==='completed'?{endedAt:'2026-10-07T07:10:00+09:00'}:{}),members:[{article:prior[0].slug,sequence:1,relation:'start',updateType:'outage',eventKey:'campaign-fixture:outage',milestone:{label:'Day 1',ordinal:1}}]};
  if(!empty)fs.writeFileSync(path.join(root,'data/series/campaign-fixture.json'),JSON.stringify(series));
  const snapshots=Array.from({length:5},(_,i)=>{
    const text=`October 8, 2026. ${identityText}. Synthetic recovery delta ${i} restores a distinct service feature. Official conditions remain documented for this test.`;
    const url=`https://openai.com/index/series-current-${i}/`;
    return {url,finalUrl:url,sourceId:'openai',category:'ai',type:'official',checked:date+'T06:20:00+09:00',text,digest:digest(text),links:[]};
  });
  const stories=snapshots.map((s,i)=>({slug:ctx.slug+`-current-${i}`,eventUrl:s.url,eventAt:date+'T05:30:00+09:00',eventDateText:'October 8, 2026',importance:`Synthetic change ${i} affects an established reader workflow with sufficient concrete relevance for editorial review.`,impact:`Synthetic impact ${i} depends on access, region and actual release conditions; the test does not assert a real announcement.`,limitations:`Synthetic limits ${i} have not been independently measured; general availability and user applicability remain uncertain.`,claims:[{kind:'fact',text:`Synthetic recovery delta ${i} restores a distinct service feature.`,citations:[{url:s.url,excerpt:`Synthetic recovery delta ${i} restores a distinct service feature.`}]},{kind:'inference',text:`Fixture ${i} may affect a future workflow, which is an editorial inference only.`,citations:[{url:s.url,excerpt:'Official conditions remain documented for this test.'}]}]}));
  const articles=stories.map((s,i)=>article(s.slug,i,date+'T06:40:00+09:00',s.eventUrl,`## 確認した事実\n\n[確認済み事実] ${s.claims[0].text}\n\n${s.importance}\n\n## じゃみおへの影響\n\n${s.impact}\n\n## 考察・未確定点\n\n[推論] ${s.claims[1].text}\n\n${s.limitations}\n\n## 出典と検証\n\nThis synthetic temporary article is not a real published story. Primary conditions must be verified against original evidence, with the date, access, region, version, actual release state and limitations separately reviewed. Citation matching and hash binding do not establish semantic accuracy, completeness, significance or publication authority.\n`));
  const folder=path.join(root,'drafts',ctx.slug);fs.mkdirSync(path.join(folder,'articles'),{recursive:true});
  const ed=edition(ctx.slug,articles,date+'T06:40:00+09:00');
  const save=()=>{fs.writeFileSync(path.join(folder,'edition.md'),serialize(ed));for(const a of articles)fs.writeFileSync(path.join(folder,'articles',a.slug+'.md'),serialize(a));fs.writeFileSync(path.join(folder,'prices.json'),'[]\n');};save();
  const report={version:1,mode:'shadow',context:ctx,status:'awaiting-editorial',publicationAuthorized:false,existingDigests:repositoryDigests(loadRepository(root)),research:{snapshots,failures:[],coverage:{ai:5},x:{status:'unavailable',note:'Synthetic only'}}};
  const evidence={version:1,context:ctx,reportDigest:hash(report),packageDigest:hash(readDraft(folder)),stories};
  const input=createSeriesInput(root,report,ctx,new Date(date+'T06:45:00+09:00'));
  const citation=(i,excerpt=snapshots[i].text)=>({url:snapshots[i].url,excerpt,checked:snapshots[i].checked,sourceDigest:snapshots[i].digest,sourceRegistryDigest:input.sourceRegistryDigest});
  const fields=[['canonicalTopic.key',identity.canonicalTopic.key],['canonicalTopic.scope',identity.canonicalTopic.scope],[`entity:${tracking}:${trackKey}`,trackKey],['region','JP'],...['productVersion','incidentId','campaignId'].filter(key=>identity[key]).map(key=>[key,identity[key]])];
  const proposals=articles.map((a,i)=>({id:`proposal-${i}`,article:a.slug,decision:i?'none':empty?'new-series':'existing-update',candidateSeriesId:i?'':'campaign-fixture',identity:structuredClone(identity),identityEvidence:fields.map(([field,value])=>({field,value,citation:citation(i)})),comparedCandidates:empty?[]:[{candidateSeriesId:series.id,disposition:i?'excluded':'match',reason:i?'Different change in a synthetic negative story':'Same tracked campaign with concrete recovery'}],comparedClaims:input.corpus.map(c=>({article:c.article,articleDigest:c.articleDigest,excerpt:previousClaim,disposition:i||empty||c.article!==prior[0].slug?'excluded':'same-target',reason:'Compare actual prior claim and scope separately'})),...(i||empty?{}:{previousIdentity:structuredClone(identity)}),novelty:{kind:i?'no-change':'material-update',delta:i?'':stories[i].claims[0].text,continuityReason:i?'':'Campaign tracking continues from outage into recovery',...(i||empty?{}:{previousArticle:prior[0].slug})},event:{key:`campaign-fixture:recovery-${i}`,url:stories[i].eventUrl,at:stories[i].eventAt,updateType:'recovery',milestone:{label:'Day 2',ordinal:2}},citations:[citation(i)],reason:'Synthetic decision for regression testing',confidence:0.99}));
  const submission={version:1,mode:'read-only',binding:proposalBinding(input,readDraft(folder),evidence),proposals};
  const evaluate=(digestValue=hash(submission),current=ctx,time=new Date(date+'T06:45:00+09:00'))=>evaluateSeriesProposals(root,{input,report,folder,evidence,submission,expectedProposalDigest:digestValue},current,time);
  const refresh=()=>{save();evidence.reportDigest=hash(report);evidence.packageDigest=hash(readDraft(folder));Object.assign(input,createSeriesInput(root,report,ctx,new Date(date+'T06:45:00+09:00')));submission.binding=proposalBinding(input,readDraft(folder),evidence);};
  return {root,ctx,series,prior,previousClaim,identity,folder,report,evidence,input,submission,articles,snapshots,stories,ed,citation,evaluate,refresh,save};
}
const label=(f,evaluation)=>({version:1,evaluationDigest:hash(evaluation),reviewer:'Synthetic fixture reviewer',reviewedAt:f.ctx.date+'T07:00:00+09:00',items:evaluation.eligibleArticles.map((article,i)=>({article,expectedDecision:i?'none':f.submission.proposals[0].decision,expectedSeriesId:i?'':f.submission.proposals[0].candidateSeriesId,duplicate:false,ambiguous:false}))});

test('detached proposal verifies morning evidence, preserves files and digest, never registers or publishes',t=>{
  const f=fixture(t),before=repositoryDigests(loadRepository(f.root)),registry=fs.readFileSync(path.join(f.root,'data/series/campaign-fixture.json'),'utf8');
  const result=f.evaluate();assert.equal(result.status,'proposal-valid');assert.equal(result.metrics.proposalCount,5);assert.equal(result.metrics.coverage.ratio,1);assert.equal(result.metrics.humanLabel,'unevaluated');assert.equal(result.metrics.falseMerge,null);assert.equal(result.binding.runCreatedAt,'2026-10-07T21:00:00Z');assert.equal(result.binding.headSha,f.ctx.baseSha);assert.equal(result.publicationAuthorized,false);assert.equal(result.registrationAuthorized,false);
  assert.deepEqual(repositoryDigests(loadRepository(f.root)),before);assert.equal(fs.readFileSync(path.join(f.root,'data/series/campaign-fixture.json'),'utf8'),registry);assert.ok(!fs.existsSync(path.join(f.root,'content/editions',f.ctx.slug+'.md')));
});
for(const [name,mutate] of [
  ['same company different topic',p=>{p.identity.canonicalTopic.key='different-campaign';p.previousIdentity=structuredClone(p.identity);}],
  ['same campaign different region',p=>{p.previousIdentity.region='US';}],
  ['same product different version',p=>{p.previousIdentity.productVersion='v2';}],
  ['different incident ID',p=>{p.previousIdentity.incidentId='incident-B';}],
  ['confidence 1 cannot waive missing evidence',p=>{p.confidence=1;p.identityEvidence=[];}],
  ['nonexistent candidate ID',p=>{p.candidateSeriesId='absent';}],
  ['missing compared competitor',p=>{p.comparedCandidates=[];}],
  ['fake source citation',p=>{p.citations[0].excerpt='This fabricated excerpt never appears in fetched source.';}],
  ['wrong source digest',p=>{p.citations[0].sourceDigest='f'.repeat(64);}],
  ['wrong source registry digest',p=>{p.citations[0].sourceRegistryDigest='f'.repeat(64);}],
  ['wrong source acquisition time',p=>{p.citations[0].checked='2026-10-08T06:21:00+09:00';}],
  ['fake identity literal',p=>{p.identityEvidence[0].value='not-in-source';}],
  ['missing published claim comparisons',p=>{p.comparedClaims.pop();}],
  ['changed previous article digest',p=>{p.comparedClaims[0].articleDigest='f'.repeat(64);}],
  ['fake previous claim',p=>{p.comparedClaims[0].excerpt='Invented historical claim never published anywhere.';}],
  ['no novelty',p=>{p.novelty.kind='no-change';}],
  ['delta absent from source',p=>{p.novelty.delta='An unsupported change to the campaign service.';}],
  ['event not bound to morning story',p=>{p.event.url='https://openai.com/index/wrong/';}],
  ['recycled event identity',p=>{p.event.key='campaign-fixture:outage';}],
  ['false existing as new-series',p=>{p.decision='new-series';}],
  ['milestone reverses',p=>{p.event.milestone.ordinal=0;}],
  ['unknown public-sidecar key',p=>{p.members=[];}]
])test(`proposal fails closed: ${name}`,t=>{const f=fixture(t);mutate(f.submission.proposals[0]);assert.throws(()=>f.evaluate());});

test('organization-only identity is never enough for a positive series proposal',t=>{const f=fixture(t,{empty:true});f.submission.proposals[0].identity.entities=[{type:'organization',key:'OpenAI',label:'OpenAI'}];assert.throws(()=>f.evaluate(),/strong tracking/);});
test('empty trusted registry supports a detached new-series slug without registration',t=>{const f=fixture(t,{empty:true});assert.equal(f.evaluate().metrics.decisions['new-series'],1);assert.deepEqual(fs.readdirSync(path.join(f.root,'data/series')),[]);});
for(const status of ['paused','completed'])test(`${status} series requires needs-review; no automatic resume`,t=>{const f=fixture(t,{status});assert.throws(()=>f.evaluate(),/inactive/);f.submission.proposals[0].decision='needs-review';assert.equal(f.evaluate().metrics.decisions['needs-review'],1);});
test('multiple candidate matches and ambiguity require review, all competitor exclusions remain detached',t=>{
  const f=fixture(t),other={...f.series,id:'competitor',members:[]};fs.writeFileSync(path.join(f.root,'data/series/competitor.json'),JSON.stringify(other));f.refresh();
  for(const p of f.submission.proposals)p.comparedCandidates.push({candidateSeriesId:'competitor',disposition:'excluded',reason:'Distinct reviewed scope'});
  assert.doesNotThrow(()=>f.evaluate());f.submission.proposals[0].comparedCandidates[1].disposition='match';assert.throws(()=>f.evaluate(),/competing/);f.submission.proposals[0].decision='needs-review';assert.doesNotThrow(()=>f.evaluate());
});
for(const updateType of ['outage','recovery','postmortem'])test(`same incident ${updateType} proposal retains a distinct event identity and delta`,t=>{const f=fixture(t,{tracking:'incident'});f.submission.proposals[0].event.updateType=updateType;assert.doesNotThrow(()=>f.evaluate());});
test('product v1 identity is grounded in both current source and prior claim; v2 cannot merge',t=>{const f=fixture(t,{tracking:'product'});assert.doesNotThrow(()=>f.evaluate());f.submission.proposals[0].previousIdentity.productVersion='v2';assert.throws(()=>f.evaluate(),/version/);});
test('incident-A identity is grounded in both snapshots; incident-B cannot merge',t=>{const f=fixture(t,{tracking:'incident'});assert.doesNotThrow(()=>f.evaluate());f.submission.proposals[0].previousIdentity.incidentId='incident-B';assert.throws(()=>f.evaluate(),/incident/);});
test('Day 1/2/5 milestones and two distinct events on same Day do not imply sequence or registration',t=>{
  const f=fixture(t);
  for(const ordinal of [1,2,5]){f.submission.proposals[0].event.milestone={ordinal,label:`Day ${ordinal}`};assert.doesNotThrow(()=>f.evaluate());}
  const p=f.submission.proposals[1],original=f.submission.proposals[0];Object.assign(p,structuredClone(original),{id:'proposal-1',article:f.articles[1].slug,event:{...original.event,key:'campaign-fixture:second-event',url:f.stories[1].eventUrl},citations:[f.citation(1)],identityEvidence:original.identityEvidence.map(x=>({...x,citation:f.citation(1)})),novelty:{...original.novelty,delta:f.stories[1].claims[0].text}});
  assert.equal(f.evaluate().metrics.decisions['existing-update'],2);
});
for(const [name,mutate] of [
  ['stale registry revision',f=>{const s={...f.series,revision:2};fs.writeFileSync(path.join(f.root,'data/series/campaign-fixture.json'),JSON.stringify(s));}],
  ['source registry advanced',f=>{const file=path.join(f.root,'config/research-sources.json'),s=JSON.parse(fs.readFileSync(file,'utf8'));s.sources.pop();fs.writeFileSync(file,JSON.stringify(s));}],
  ['proposal tampering after receiver digest pin',f=>{f.submission.proposals[0].reason='Altered by untrusted producer';}],
  ['source body mutation without digest change',f=>{f.snapshots[0].text+=' changed body';}],
  ['source body and self digest mutation',f=>{f.snapshots[0].text+=' changed body';f.snapshots[0].digest=digest(f.snapshots[0].text);}],
  ['source shortage',f=>{f.snapshots.pop();}],
  ['X discovery only',f=>{f.snapshots[0].url='https://x.com/a/status/123';}],
  ['missing autonomous evidence',f=>{f.evidence.stories=[];}],
  ['duplicate proposal',f=>{f.submission.proposals.push(structuredClone(f.submission.proposals[0]));}],
  ['duplicate event across articles',f=>{f.submission.proposals[1].event.key=f.submission.proposals[0].event.key;}],
  ['registry digest self replacement',f=>{f.submission.binding.registryDigest='f'.repeat(64);}],
  ['run attempt replacement',f=>{f.submission.binding.context={...f.ctx,attempt:2};}],
  ['head SHA replacement',f=>{f.submission.binding.headSha='b'.repeat(40);}],
  ['original run timestamp replacement',f=>{f.submission.binding.runCreatedAt='2026-10-07T22:00:00Z';}],
  ['package modified after binding',f=>{f.articles[0].body+=' Altered package';f.save();}],
  ['proposal leaked into front matter',f=>{f.articles[0].series='campaign-fixture';f.save();}]
])test(`binding rejects ${name}`,t=>{const f=fixture(t),pinned=hash(f.submission);mutate(f);assert.throws(()=>f.evaluate(name==='proposal tampering after receiver digest pin'?pinned:hash(f.submission)));});
test('stale main, latest attempt mismatch, next-day retry and elapsed lease stop evaluation',t=>{
  const f=fixture(t);for(const current of [{...f.ctx,baseSha:'b'.repeat(40)},{...f.ctx,attempt:2}])assert.throws(()=>f.evaluate(hash(f.submission),current));
  for(const time of ['2026-10-09T06:00:00+09:00','2026-10-08T08:01:00+09:00'])assert.throws(()=>f.evaluate(hash(f.submission),f.ctx,new Date(time)),/Stale/);
});
for(const name of ['mutable URL only body updated','same URL reused for another incident'])test(`${name} cannot bypass existing fresh eventUrl rule`,t=>{
  const f=fixture(t),oldUrl=f.prior[0].sources[0].url,s=f.snapshots[0];s.url=oldUrl;s.finalUrl=oldUrl;f.articles[0].sources[0].url=oldUrl;f.stories[0].eventUrl=oldUrl;for(const c of f.stories[0].claims)for(const x of c.citations)x.url=oldUrl;f.submission.proposals[0].event.url=oldUrl;for(const c of f.submission.proposals[0].citations)c.url=oldUrl;for(const x of f.submission.proposals[0].identityEvidence)x.citation.url=oldUrl;f.refresh();assert.throws(()=>f.evaluate(),/recycled/);
});
test('evening evidence and already-published morning cannot enter series proposal validation',t=>{
  const f=fixture(t);f.report.context={...f.ctx,slug:f.ctx.date+'-evening'};assert.throws(()=>f.evaluate());f.report.context=f.ctx;f.report.status='already-published';f.refresh();assert.equal(f.input.status,'ineligible-morning');assert.throws(()=>f.evaluate(),/ineligible/);
});
test('human label binding exposes false merge, missed continuation, duplicate, ambiguity and partial coverage',t=>{
  const f=fixture(t),e=f.evaluate(),labels=label(f,e);assert.equal(humanMetrics(e,f.submission,undefined).falseMerge,null);assert.equal(humanMetrics(e,f.submission,labels).humanLabel,'evaluated');
  labels.items[0].expectedSeriesId='different-target';labels.items[1].expectedDecision='existing-update';labels.items[1].expectedSeriesId='campaign-fixture';labels.items[2].duplicate=true;labels.items[3].ambiguous=true;
  const m=humanMetrics(e,f.submission,labels);assert.equal(m.falseMerge,1);assert.equal(m.missedContinuation,2);assert.equal(m.duplicateProposal,1);assert.equal(m.ambiguous,1);
  labels.items.pop();assert.equal(humanMetrics(e,f.submission,labels).humanLabel,'partially-evaluated');labels.evaluationDigest='f'.repeat(64);assert.throws(()=>humanMetrics(e,f.submission,labels));
});
test('partial proposal coverage is valid for observation, uncovered human continuation counts as missed',t=>{
  const f=fixture(t);f.submission.proposals.pop();const e=f.evaluate();assert.equal(e.metrics.coverage.ratio,0.8);const l=label(f,e);l.items[4].expectedDecision='existing-update';l.items[4].expectedSeriesId='campaign-fixture';assert.equal(humanMetrics(e,f.submission,l).missedContinuation,1);
});
test('related-only and none are retained alongside needs-review in decision metrics',t=>{const f=fixture(t);f.submission.proposals[1].decision='related-only';f.submission.proposals[1].candidateSeriesId='campaign-fixture';f.submission.proposals[2].decision='needs-review';const m=f.evaluate().metrics;assert.deepEqual(m.decisions,{'existing-update':1,'new-series':0,'related-only':1,'none':2,'needs-review':1});});
test('distinct event URLs with the same identity and delta are duplicate proposals',t=>{
  const f=fixture(t),first=f.submission.proposals[0],p=f.submission.proposals[1];
  f.snapshots[1].text=f.snapshots[1].text.replace('delta 1','delta 0');f.snapshots[1].digest=digest(f.snapshots[1].text);f.articles[1].body=f.articles[1].body.replace('delta 1','delta 0');f.stories[1].claims[0].text=f.stories[0].claims[0].text;f.stories[1].claims[0].citations[0].excerpt=f.stories[0].claims[0].citations[0].excerpt;
  Object.assign(p,structuredClone(first),{id:'proposal-1',article:f.articles[1].slug,event:{...first.event,key:'campaign-fixture:distinct-but-duplicate',url:f.stories[1].eventUrl},citations:[f.citation(1)],identityEvidence:first.identityEvidence.map(x=>({...x,citation:f.citation(1)}))});
  f.refresh();assert.throws(()=>f.evaluate(),/duplicate identity\/delta/);
});

async function seven(t) {
  const records=[],runs=[],fixtures=[];
  for(let i=0;i<7;i++){
    const date=`2026-10-${String(8+i).padStart(2,'0')}`,f=fixture(t,{date});f.ctx.runId=String(123+i);f.refresh();const evaluation=f.evaluate();
    records.push({input:f.input,report:f.report,bundle:readDraft(f.folder),evidence:f.evidence,submission:f.submission,evaluation,labels:label(f,evaluation)});fixtures.push(f);
    runs.push({id:123+i,run_attempt:1,path:'.github/workflows/autonomous-shadow.yml',event:'schedule',head_branch:'main',head_sha:f.ctx.baseSha,created_at:originalCreatedAt(f.ctx),status:'completed',conclusion:'success'});
  }
  const revalidate=async(record,run)=>{const f=fixtures.find(f=>f.ctx.runId===String(run.id));return evaluateSeriesProposals(f.root,{...record,folder:f.folder,expectedProposalDigest:record.evaluation.proposalDigest},f.ctx,new Date(record.evaluation.evaluatedAt));};
  const aggregate=()=>aggregateSeries(records,runs,{start:'2026-10-08',end:'2026-10-14',revalidate});return {records,runs,fixtures,revalidate,aggregate};
}
test('synthetic seven-day replay proves continuity only in fixture and never grants stage3 permission',async t=>{const s=await seven(t),a=await s.aggregate();assert.equal(a.sevenDayWindowComplete,true);assert.equal(a.qualityGateObserved,true);assert.equal(a.totals.proposalCount,35);assert.equal(a.stage3Authorized,false);});
for(const [name,mutate] of [
  ['unlabeled run',s=>delete s.records[2].labels],
  ['missing day',s=>{s.runs.splice(2,1);s.records.splice(2,1);}],
  ['missing target run',s=>s.records.pop()],
  ['additional dispatch unevaluated',s=>s.runs.push({...s.runs[2],id:999,event:'workflow_dispatch'})],
  ['failed target run',s=>s.runs[2].conclusion='failure'],
  ['partial labels',s=>s.records[2].labels.items.pop()],
  ['false merge observed',s=>s.records[2].labels.items[0].expectedSeriesId='other-target'],
  ['human ambiguity observed',s=>s.records[2].labels.items[0].ambiguous=true]
])test(`seven-day evaluation remains incomplete or fails quality gate: ${name}`,async t=>{const s=await seven(t);mutate(s);const a=await s.aggregate();assert.equal(a.qualityGateObserved,false);});
for(const [name,mutate] of [
  ['latest attempt advanced',s=>s.runs[2].run_attempt=2],
  ['base SHA replaced',s=>s.runs[2].head_sha='b'.repeat(40)],
  ['original date changed',s=>s.runs[2].created_at='2026-10-15T21:00:00Z'],
  ['duplicate record',s=>s.records.push(s.records[0])],
  ['record summary tampered',s=>s.records[2].evaluation.metrics.proposalCount=99],
  ['record proposal tampered',s=>s.records[2].submission.proposals[0].reason='tampered'],
  ['stale historical registry',s=>{const f=s.fixtures[2];fs.writeFileSync(path.join(f.root,'data/series/campaign-fixture.json'),JSON.stringify({...f.series,revision:2}));}]
])test(`aggregate fails closed: ${name}`,async t=>{const s=await seven(t);mutate(s);await assert.rejects(s.aggregate);});
test('detached output rejects public paths, traversal, overwrite and linked ancestors',t=>{
  const f=fixture(t),out=path.join(f.root,'series-shadow-output/run/input.json');saveDetached(f.root,out,{test:true});assert.throws(()=>saveDetached(f.root,out,{}));
  for(const file of ['data/series/proposal.json','content/articles/proposal.json','series-shadow-output/../data/series/p.json','dist/proposal.json'])assert.throws(()=>saveDetached(f.root,path.join(f.root,file),{}));
  const link=path.join(f.root,'series-shadow-output/link');fs.symlinkSync(path.join(f.root,'data'),link,process.platform==='win32'?'junction':'dir');assert.throws(()=>saveDetached(f.root,path.join(link,'p.json'),{}),/link/);
});
test('workflow retains read-only permissions, independent run-attempt artifact and nonpublication summary',()=>{
  const workflow=fs.readFileSync(path.join(sourceRoot,'.github/workflows/autonomous-shadow.yml'),'utf8');assert.match(workflow,/series-proposal-evaluation-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);assert.match(workflow,/series-shadow\.mjs prepare/);assert.ok(!/\bwrite\b|secrets\.|git push|gh pr|deploy-pages|applyDraft/.test(workflow));assert.match(shadowSummary({status:'awaiting-editorial'}),/read-only \/ not registered \/ not published/);assert.match(shadowSummary({status:'awaiting-editorial'}),/unevaluated/);
});
test('failure diagnostics retain rejected proposal decisions and duplicate count without evaluating humans',t=>{const f=fixture(t);f.submission.proposals.push(f.submission.proposals[0]);const m=failureMetrics(f.submission);assert.equal(m.proposalCount,6);assert.equal(m.decisions['existing-update'],2);assert.equal(m.duplicateProposal,1);assert.equal(m.evidenceFailure,1);assert.equal(m.humanLabel,'unevaluated');});
test('actual historical Git replay reconstructs base and original window; altered window or unsafe package fails',async t=>{
  const f=fixture(t),git=args=>execFileSync('git',args,{cwd:f.root,encoding:'utf8',stdio:'pipe'});
  git(['init']);git(['add','content','data','config','site.config.json']);git(['-c','user.name=Fixture','-c','user.email=fixture@jamio.invalid','commit','-m','Synthetic historical base']);
  f.ctx.baseSha=git(['rev-parse','HEAD']).trim();f.refresh();const evaluation=f.evaluate();
  const record={input:f.input,report:f.report,bundle:readDraft(f.folder),evidence:f.evidence,submission:f.submission,evaluation};const run={id:123,run_attempt:1,head_sha:f.ctx.baseSha,created_at:originalCreatedAt(f.ctx)};
  assert.deepEqual(await historicalReplay(f.root,record,run),evaluation);
  f.ctx.windowStart='2026-10-06T07:00:00+09:00';f.refresh();record.evaluation=f.evaluate();await assert.rejects(()=>historicalReplay(f.root,record,run),/Stale/);
  record.bundle.articles[0].slug='../unsafe';await assert.rejects(()=>historicalReplay(f.root,record,run));
});
test('authoritative run listing paginates across all target runs and does not accept missing data',async()=>{
  let calls=0;const run={created_at:'2026-10-10T00:00:00Z'};
  const runs=await windowRuns('2026-10-08',{get:async()=>{calls++;return {workflow_runs:calls===1?Array.from({length:100},(_,i)=>({...run,id:i+1})):[{id:101,created_at:'2026-10-07T00:00:00Z'}]};}});
  assert.equal(runs.length,101);assert.equal(calls,2);await assert.rejects(()=>windowRuns('2026-10-08',{get:async()=>({})}),/unavailable/);
});
