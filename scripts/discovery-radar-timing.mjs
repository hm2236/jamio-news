import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateContract,scheduledSlot,canonical,REPOSITORY,WORKFLOW} from './discovery-radar.mjs';

export const REPORT_BUDGET = 512*1024;
export const OBSERVATIONS_BUDGET = 256*1024;
export const RUN_BUDGET = 128*1024;
export const FAILURE = 'Radar timing input validation failed.';
const sources = [
  {id:'hn-new',adapter:'hn-item-v1',channel:'aggregator',lane:'discover',maxItems:1},
  {id:'kagoshima-new',adapter:'kagoshima-feed-v1',channel:'authority-local',lane:'sentinel',maxItems:20},
  {id:'anthropic-news',adapter:'anthropic-index-v1',channel:'publisher',lane:'watch',maxItems:20}
];
const fail = () => { throw new Error('radar-timing-invalid-input'); };
const object = value => { if(!value||typeof value!=='object'||Array.isArray(value))fail();return value; };
const integer = (value,min=0,max=Number.MAX_SAFE_INTEGER) => { if(!Number.isSafeInteger(value)||value<min||value>max)fail();return value; };
export function utcTime(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))fail();
  const date=new Date(value),normalized=date.toISOString();
  if(normalized!==(value.includes('.')?value:value.replace(/Z$/,'.000Z')))fail();
  return date.getTime();
}
function dateOnly(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail();
}
const range = values => values.length ? {minimum:Math.min(...values),maximum:Math.max(...values)} : null;
export function analyzeTiming(report,observations,apiRun,asOf) {
  try {
    object(report);object(report.run);object(apiRun);
    if(report.version!==1||report.publicationAuthorized!==false||report.rawSourceBodyPersistedBytes!==0||apiRun.repository?.full_name!==REPOSITORY||apiRun.path!==WORKFLOW||apiRun.head_branch!=='main'||apiRun.status!=='completed'||apiRun.conclusion!=='success'||!['schedule','workflow_dispatch'].includes(apiRun.event))fail();
    integer(apiRun.id,1);integer(apiRun.run_attempt,1);
    if(!/^[a-f0-9]{40}$/.test(apiRun.head_sha||'')||report.run.runId!==String(apiRun.id)||report.run.attempt!==apiRun.run_attempt||report.run.headSha!==apiRun.head_sha||report.run.runCreatedAt!==apiRun.created_at||report.run.event!==apiRun.event)fail();
    const created=utcTime(apiRun.created_at),workflowStarted=utcTime(apiRun.run_started_at),started=utcTime(report.run.startedAt),completed=utcTime(report.run.completedAt),asOfTime=utcTime(asOf);
    if(created>workflowStarted||workflowStarted>started||started>completed||asOfTime<completed)fail();
    const slot=scheduledSlot(apiRun.created_at,apiRun.event),delay=slot?(started-utcTime(slot))/1000:null;
    const method=slot?'latest-hourly-17-slot-before-run-creation':'not-scheduled';
    if(report.run.scheduledSlotAt!==slot||report.run.scheduleDelaySeconds!==delay||report.run.scheduleDelayMethod!==method)fail();
    if(!Array.isArray(observations)||observations.length>41||!Array.isArray(report.sourceHealth)||report.sourceHealth.length!==3)fail();
    const sourceCounts=new Map();
    for(const health of report.sourceHealth){object(health);const source=sources.find(source=>source.id===health.sourceId);if(!source||sourceCounts.has(source.id))fail();integer(health.itemCount,0,source.maxItems);sourceCounts.set(source.id,health.itemCount);}
    const ids=new Set(),groups=new Map(sources.map(source=>[source.id,[]]));
    for(const observation of observations) {
      validateContract(observation,'observation');
      const source=sources.find(source=>source.id===observation.sourceId);
      if(!source||observation.adapterId!==source.adapter||observation.channelClass!==source.channel||observation.laneHint!==source.lane||ids.has(observation.observationId))fail();
      ids.add(observation.observationId);
      const captured=utcTime(observation.capturedAt),observed=utcTime(observation.observedAt);
      if(captured<started||observed<captured||observed>completed)fail();
      let published=null;
      if(observation.sourceTimePrecision==='datetime'){published=utcTime(observation.sourcePublishedAt);}
      else if(observation.sourceTimePrecision==='date'){dateOnly(observation.sourcePublishedAt);}
      else if(observation.sourcePublishedAt!==null)fail();
      if(observation.sourceUpdatedAt!==null){if(/^\d{4}-\d{2}-\d{2}$/.test(observation.sourceUpdatedAt))dateOnly(observation.sourceUpdatedAt);else utcTime(observation.sourceUpdatedAt);}
      groups.get(source.id).push({recognitionSeconds:(observed-captured)/1000,publishedAgeSeconds:published===null?null:(captured-published)/1000,precision:observation.sourceTimePrecision});
    }
    const diagnostics=sources.map(source=>{
      const rows=groups.get(source.id);if(rows.length!==sourceCounts.get(source.id))fail();
      const datetime=rows.filter(row=>row.precision==='datetime').map(row=>row.publishedAgeSeconds),future=datetime.filter(age=>age<0);
      return {sourceId:source.id,acceptedObservationCount:rows.length,bodyCompleteToRecognitionSeconds:range(rows.map(row=>row.recognitionSeconds)),datetimePublishedCount:datetime.length,datetimePublishedToBodyAgeSeconds:range(datetime),futurePublishedCount:future.length,futurePublishedToBodyAgeSeconds:range(future),dateOnlyPublishedCount:rows.filter(row=>row.precision==='date').length,dateOnlyExactAgeSeconds:null,unknownPublishedCount:rows.filter(row=>row.precision==='unknown').length,unknownExactAgeSeconds:null};
    });
    return {version:1,publicationAuthorized:false,editorialCoverage:'NOT PROVEN',clockAttestation:'NOT PROVEN',inputOriginIntegrity:'OPERATOR VERIFICATION PREREQUISITE; NOT ATTESTED BY THIS UTILITY',asOf,
      run:{runId:report.run.runId,attempt:report.run.attempt,headSha:report.run.headSha,runCreatedAt:apiRun.created_at,workflowStartedAt:apiRun.run_started_at,collectorStartedAt:report.run.startedAt,collectorCompletedAt:report.run.completedAt,creationToWorkflowSeconds:(workflowStarted-created)/1000,workflowToCollectorSeconds:(started-workflowStarted)/1000,creationToCollectorSeconds:(started-created)/1000,collectorDurationSeconds:(completed-started)/1000,completedCaptureAgeSeconds:(asOfTime-completed)/1000},
      schedule:{event:apiRun.event,slotEstimate:slot,delayFromSlotEstimateSeconds:delay,method,originalIntendedCronTime:'NOT PROVEN',missedSlotCount:null},sources:diagnostics};
  } catch { fail(); }
}
export function readBoundedText(file,budget) {
  let fd;
  try {
    integer(budget,1,REPORT_BUDGET);
    const before=fs.lstatSync(file);if(before.isSymbolicLink()||!before.isFile()||before.size>budget)fail();
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const opened=fs.fstatSync(fd);
    if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size>budget)fail();
    const buffer=Buffer.alloc(budget+1);let size=0;
    while(size<buffer.length){const n=fs.readSync(fd,buffer,size,buffer.length-size,null);if(!n)break;size+=n;}
    if(size>budget)fail();
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size));
  } catch { fail(); }
  finally { if(fd!==undefined)fs.closeSync(fd); }
}
export function parseObservations(text) {
  try {
    if(typeof text!=='string'||Buffer.byteLength(text)>OBSERVATIONS_BUDGET)fail();
    if(text==='')return [];
    const rows=text.split(/\r?\n/);if(rows.at(-1)==='')rows.pop();if(rows.length>41||rows.some(row=>!row.trim()))fail();
    return rows.map(row=>JSON.parse(row));
  } catch { fail(); }
}
export function analyzeFiles(reportFile,observationsFile,runFile,asOf) {
  try {
    const report=JSON.parse(readBoundedText(reportFile,REPORT_BUDGET)),observations=parseObservations(readBoundedText(observationsFile,OBSERVATIONS_BUDGET)),apiRun=JSON.parse(readBoundedText(runFile,RUN_BUDGET));
    return analyzeTiming(report,observations,apiRun,asOf);
  } catch { fail(); }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { if(process.argv.length!==6)fail();console.log(canonical(analyzeFiles(...process.argv.slice(2)))); }
  catch { console.error(FAILURE);process.exitCode=1; }
}
