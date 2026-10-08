import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {observation,scheduledSlot,REPOSITORY,WORKFLOW} from '../scripts/discovery-radar.mjs';
import {REPORT_BUDGET,OBSERVATIONS_BUDGET,RUN_BUDGET,FAILURE,utcTime,analyzeTiming,readBoundedText,parseObservations,analyzeFiles} from '../scripts/discovery-radar-timing.mjs';

const config=JSON.parse(fs.readFileSync(new URL('../config/discovery-radar-sources.json',import.meta.url),'utf8'));
const created='2026-10-08T12:18:00Z',start='2026-10-08T12:19:00.000Z',end='2026-10-08T12:20:00.000Z',asOf='2026-10-08T13:20:00Z';
function row(source,index=1,precision='datetime',published='2026-10-08T11:19:10.000Z') {
  return observation({sourceItemId:source.id==='anthropic-news'?null:String(index),canonicalUrl:source.id==='hn-new'?`https://news.ycombinator.com/item?id=${index}`:source.id==='kagoshima-new'?`https://www.pref.kagoshima.jp/fixture-${index}.html`:`https://www.anthropic.com/news/fixture-${index}`,sourceUrl:null,title:'PRIVATE TITLE',published,updated:null,precision,discoveredUrls:[],semantic:{source:source.id,index}},source,'2026-10-08T12:19:10.000Z','2026-10-08T12:19:12.000Z');
}
function fixture() {
  const api={id:123,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',path:WORKFLOW,repository:{full_name:REPOSITORY},created_at:created,run_started_at:created,status:'completed',conclusion:'success',event:'schedule'};
  const report={version:1,publicationAuthorized:false,rawSourceBodyPersistedBytes:0,run:{runId:'123',attempt:1,headSha:api.head_sha,runCreatedAt:created,startedAt:start,completedAt:end,event:'schedule',scheduledSlotAt:scheduledSlot(created,'schedule'),scheduleDelaySeconds:120,scheduleDelayMethod:'latest-hourly-17-slot-before-run-creation'},sourceHealth:config.sources.map(source=>({sourceId:source.id,itemCount:1}))};
  const observations=[row(config.sources[0]),row(config.sources[1],2,'unknown',null),row(config.sources[2],3,'date','2026-10-08')];
  return {report,observations,api,asOf};
}
const analyze=f=>analyzeTiming(f.report,f.observations,f.api,f.asOf);
function files(t,f=fixture()) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'radar-timing-fixture-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const reportFile=path.join(temp,'report.json'),observationsFile=path.join(temp,'observations.jsonl'),runFile=path.join(temp,'run.json');
  fs.writeFileSync(reportFile,JSON.stringify(f.report));fs.writeFileSync(observationsFile,f.observations.map(o=>JSON.stringify(o)).join('\n')+'\n');fs.writeFileSync(runFile,JSON.stringify(f.api));return {temp,reportFile,observationsFile,runFile};
}

test('separates run creation, collector start/completion, capture age and conservative schedule estimate',()=>{
  const result=analyze(fixture());assert.equal(result.run.creationToCollectorSeconds,60);assert.equal(result.run.collectorDurationSeconds,60);assert.equal(result.run.completedCaptureAgeSeconds,3600);assert.equal(result.schedule.slotEstimate,'2026-10-08T12:17:00.000Z');assert.equal(result.schedule.delayFromSlotEstimateSeconds,120);assert.equal(result.schedule.originalIntendedCronTime,'NOT PROVEN');assert.equal(result.schedule.missedSlotCount,null);
});
test('precision-aware ages keep datetime, date-only and unknown values separate',()=>{
  const result=analyze(fixture());assert.deepEqual(result.sources[0].bodyCompleteToRecognitionSeconds,{minimum:2,maximum:2});assert.deepEqual(result.sources[0].datetimePublishedToBodyAgeSeconds,{minimum:3600,maximum:3600});assert.equal(result.sources[1].unknownPublishedCount,1);assert.equal(result.sources[1].unknownExactAgeSeconds,null);assert.equal(result.sources[2].dateOnlyPublishedCount,1);assert.equal(result.sources[2].dateOnlyExactAgeSeconds,null);assert.equal(result.sources[2].datetimePublishedToBodyAgeSeconds,null);
});
test('future source datetime age remains negative with explicit separate future count/range',()=>{
  const f=fixture();f.observations[0].sourcePublishedAt='2026-10-08T12:20:10Z';const value=analyze(f).sources[0];assert.deepEqual(value.datetimePublishedToBodyAgeSeconds,{minimum:-60,maximum:-60});assert.deepEqual(value.futurePublishedToBodyAgeSeconds,{minimum:-60,maximum:-60});assert.equal(value.futurePublishedCount,1);
});
test('sourceUpdatedAt is not substituted for unknown/null publication time',()=>{
  const f=fixture();f.observations[1].sourceUpdatedAt='2026-10-08T11:00:00Z';const result=analyze(f).sources[1];assert.equal(result.unknownPublishedCount,1);assert.equal(result.datetimePublishedToBodyAgeSeconds,null);
});
test('date-only future calendar date keeps null exact age without future-instant assertion',()=>{
  const f=fixture();f.observations[2].sourcePublishedAt='2026-10-09';const result=analyze(f).sources[2];assert.equal(result.dateOnlyExactAgeSeconds,null);assert.equal(result.futurePublishedCount,0);
});
test('manual dispatch has no schedule estimate, delay or missed-slot assertion',()=>{
  const f=fixture();f.api.event='workflow_dispatch';f.report.run.event='workflow_dispatch';f.report.run.scheduledSlotAt=null;f.report.run.scheduleDelaySeconds=null;f.report.run.scheduleDelayMethod='not-scheduled';const result=analyze(f);assert.equal(result.schedule.slotEstimate,null);assert.equal(result.schedule.delayFromSlotEstimateSeconds,null);assert.equal(result.schedule.method,'not-scheduled');
});
for(const [creation,expected] of [['2026-10-08T12:16:59Z','2026-10-08T11:17:00.000Z'],['2026-10-08T12:17:00Z','2026-10-08T12:17:00.000Z'],['2026-10-08T00:00:00Z','2026-10-07T23:17:00.000Z']])test(`latest:17-slot estimate boundary ${creation}`,()=>{
  const f=fixture();f.api.created_at=creation;f.api.run_started_at=creation;f.report.run.runCreatedAt=creation;f.report.run.scheduledSlotAt=scheduledSlot(creation,'schedule');f.report.run.scheduleDelaySeconds=(Date.parse(start)-Date.parse(expected))/1000;assert.equal(analyze(f).schedule.slotEstimate,expected);
});
test('valid second/millisecond UTC preserves fractional arithmetic',()=>{
  const f=fixture();f.observations=[];f.report.sourceHealth.forEach(h=>h.itemCount=0);f.report.run.startedAt='2026-10-08T12:18:00.500Z';f.report.run.completedAt='2026-10-08T12:18:01.250Z';f.report.run.scheduleDelaySeconds=60.5;f.asOf='2026-10-08T12:18:02Z';const result=analyze(f);assert.equal(result.run.creationToCollectorSeconds,0.5);assert.equal(result.run.collectorDurationSeconds,0.75);assert.equal(result.run.completedCaptureAgeSeconds,0.75);assert.ok(result.sources.every(s=>s.bodyCompleteToRecognitionSeconds===null));
});
test('41-row fixed-source maximum is accepted with matching item counts',()=>{
  const f=fixture();f.observations=[row(config.sources[0]),...Array.from({length:20},(_,i)=>row(config.sources[1],i+1)),...Array.from({length:20},(_,i)=>row(config.sources[2],i+1))];f.report.sourceHealth.forEach((h,i)=>h.itemCount=i===0?1:20);assert.deepEqual(analyze(f).sources.map(s=>s.acceptedObservationCount),[1,20,20]);
});
test('W0 optional additive fields accepted without dependency; outputs never echo titles/URLs/health codes',()=>{
  const f=fixture();f.report.stateMigrations=[{sourceId:'kagoshima-new',action:'reset-source'}];f.report.title='PRIVATE REPORT';f.report.sourceHealth[0].code='::error::PRIVATE HEALTH';f.api.secret='PRIVATE API';const text=JSON.stringify(analyze(f));for(const phrase of ['PRIVATE','https://','::error::'])assert.ok(!text.includes(phrase));assert.ok(text.includes('NOT PROVEN'));assert.equal(analyze(f).publicationAuthorized,false);assert.ok(text.includes('OPERATOR VERIFICATION PREREQUISITE'));
});
for(const [name,change] of [
  ['report version',f=>f.report.version=2],['publication flag',f=>f.report.publicationAuthorized=true],['raw body flag',f=>f.report.rawSourceBodyPersistedBytes=1],
  ['API repository',f=>f.api.repository.full_name='foreign/repo'],['API workflow',f=>f.api.path='other.yml'],['API branch',f=>f.api.head_branch='feature'],['API status',f=>f.api.status='in_progress'],['API conclusion',f=>f.api.conclusion='failure'],['API event',f=>f.api.event='push'],
  ['run binding',f=>f.report.run.runId='124'],['attempt binding',f=>f.report.run.attempt=2],['head binding',f=>f.report.run.headSha='b'.repeat(40)],['creation binding',f=>f.report.run.runCreatedAt='2026-10-08T12:18:00.000Z'],['event binding',f=>f.report.run.event='workflow_dispatch'],
  ['as-of before capture',f=>f.asOf='2026-10-08T12:19:59Z'],['collector before creation',f=>f.report.run.startedAt='2026-10-08T12:17:00Z'],['completion before start',f=>f.report.run.completedAt='2026-10-08T12:18:00Z'],
  ['workflow before creation',f=>f.api.run_started_at='2026-10-08T12:17:59Z'],['workflow after collector',f=>f.api.run_started_at='2026-10-08T12:19:01Z'],['missing workflow start',f=>delete f.api.run_started_at],
  ['slot contradiction',f=>f.report.run.scheduledSlotAt='2026-10-08T11:17:00.000Z'],['delay contradiction',f=>f.report.run.scheduleDelaySeconds=999],['method contradiction',f=>f.report.run.scheduleDelayMethod='original-cron-time'],
  ['missing source',f=>f.report.sourceHealth.pop()],['unknown source',f=>f.report.sourceHealth[0].sourceId='foreign'],['duplicate source',f=>f.report.sourceHealth[1]=f.report.sourceHealth[0]],['count contradiction',f=>f.report.sourceHealth[1].itemCount=0],['oversized HN count',f=>f.report.sourceHealth[0].itemCount=2],
  ['duplicate observation',f=>f.observations.push(f.observations[0])],['unknown Observation source',f=>f.observations[0].sourceId='foreign'],['adapter mismatch',f=>f.observations[0].adapterId='kagoshima-feed-v1'],['channel mismatch',f=>f.observations[0].channelClass='publisher'],['lane mismatch',f=>f.observations[0].laneHint='watch'],
  ['captured before collector',f=>f.observations[0].capturedAt='2026-10-08T12:18:59Z'],['observed before captured',f=>f.observations[0].observedAt='2026-10-08T12:19:09Z'],['observed after collector',f=>f.observations[0].observedAt='2026-10-08T12:20:01Z'],
  ['datetime publication null',f=>f.observations[0].sourcePublishedAt=null],['date publication null',f=>f.observations[2].sourcePublishedAt=null],['unknown publication non-null',f=>f.observations[1].sourcePublishedAt='2026-10-08T11:00:00Z'],['date publication timestamp',f=>f.observations[2].sourcePublishedAt='2026-10-08T00:00:00Z'],['datetime publication date',f=>f.observations[0].sourcePublishedAt='2026-10-08'],['updated invalid calendar',f=>f.observations[0].sourceUpdatedAt='2026-02-30'],
  ['42 rows',f=>f.observations=Array.from({length:42},()=>f.observations[0])]
])test(`${name} fails with fixed input error`,()=>{const f=fixture();change(f);assert.throws(()=>analyze(f),{message:'radar-timing-invalid-input'});});
for(const value of ['2026-99-99T00:00:00Z','2026-02-30T00:00:00Z','2026-10-08T24:00:00Z','2026-10-08T12:00:60Z','2026-10-08T12:00:00+00:00','2026-10-08T12:00:00.12Z','2026-10-08'])test(`noncanonical UTC timestamp ${value} fails`,()=>{assert.throws(()=>utcTime(value),/radar-timing-invalid-input/);});
test('bounded CLI reads verified fixture files and produces only derived JSON',t=>{
  const f=fixture(),paths=files(t,f);assert.deepEqual(analyzeFiles(paths.reportFile,paths.observationsFile,paths.runFile,f.asOf),analyze(f));const script=fileURLToPath(new URL('../scripts/discovery-radar-timing.mjs',import.meta.url));const text=execFileSync(process.execPath,[script,paths.reportFile,paths.observationsFile,paths.runFile,f.asOf],{encoding:'utf8',stdio:'pipe'});assert.deepEqual(JSON.parse(text),analyze(f));assert.ok(!text.includes('PRIVATE'));
});
test('each input budget is enforced, including strict UTF8/missing/directory failures',t=>{
  const f=fixture(),paths=files(t,f);
  for(const [file,budget] of [[paths.reportFile,REPORT_BUDGET],[paths.observationsFile,OBSERVATIONS_BUDGET],[paths.runFile,RUN_BUDGET]]){fs.writeFileSync(file,Buffer.alloc(budget+1,32));assert.throws(()=>readBoundedText(file,budget),/radar-timing-invalid-input/);fs.writeFileSync(file,Buffer.from([0xc0,0xaf]));assert.throws(()=>readBoundedText(file,budget),/radar-timing-invalid-input/);}
  assert.throws(()=>readBoundedText(paths.temp,REPORT_BUDGET),/radar-timing-invalid-input/);assert.throws(()=>readBoundedText(path.join(paths.temp,'missing'),REPORT_BUDGET),/radar-timing-invalid-input/);
});
test('file symlink to regular input is rejected',{skip:process.platform==='win32'},t=>{
  const p=files(t),link=path.join(p.temp,'link.json');fs.symlinkSync(p.reportFile,link);assert.throws(()=>readBoundedText(link,REPORT_BUDGET),/radar-timing-invalid-input/);
});
test('input path junction/symlink is rejected before read',t=>{
  const p=files(t),link=path.join(p.temp,'link');fs.symlinkSync(p.temp,link,'junction');assert.throws(()=>readBoundedText(link,REPORT_BUDGET),/radar-timing-invalid-input/);
});
test('JSONL handles empty/CRLF fixtures but rejects malformed/interior blanks/oversized rows',()=>{
  assert.deepEqual(parseObservations(''),[]);assert.equal(parseObservations('{}\r\n{}\r\n').length,2);for(const value of ['{','{}\n\n{}','{}\n'.repeat(42),' '.repeat(OBSERVATIONS_BUDGET+1)])assert.throws(()=>parseObservations(value),/radar-timing-invalid-input/);
});
test('CLI failures are fixed, empty stdout, no partial derived output or raw exception echo',t=>{
  const p=files(t),script=fileURLToPath(new URL('../scripts/discovery-radar-timing.mjs',import.meta.url));fs.writeFileSync(p.reportFile,'{ PRIVATE MALFORMED TEXT');
  for(const args of [[p.reportFile,p.observationsFile,p.runFile,asOf],[p.reportFile,p.observationsFile,p.runFile]]){try{execFileSync(process.execPath,[script,...args],{encoding:'utf8',stdio:'pipe'});assert.fail('expected failure');}catch(error){assert.equal(error.status,1);assert.equal(error.stdout,'');assert.equal(error.stderr.trim(),FAILURE);assert.ok(!error.stderr.includes('PRIVATE'));}}
});
test('workflow start is distinct from collector start, with separate queue/setup delays',()=>{
  const f=fixture();f.api.run_started_at='2026-10-08T12:18:20Z';const result=analyze(f);
  assert.equal(result.run.workflowStartedAt,f.api.run_started_at);assert.equal(result.run.collectorStartedAt,start);assert.equal(result.run.creationToWorkflowSeconds,20);assert.equal(result.run.workflowToCollectorSeconds,40);assert.equal(result.run.creationToCollectorSeconds,60);
});
