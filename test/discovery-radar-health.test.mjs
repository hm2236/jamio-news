import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSourceFetcher,capture,emptyState,REPOSITORY,WORKFLOW} from '../scripts/discovery-radar.mjs';
import {REPORT_BUDGET,WARNING,FAILURE,expectedBinding,readReport,validateReport,renderReport,summarize} from '../scripts/discovery-radar-health.mjs';

const config=JSON.parse(fs.readFileSync(new URL('../config/discovery-radar-sources.json',import.meta.url),'utf8'));
const at='2026-10-08T12:17:00.000Z',later='2026-10-08T12:17:01.000Z';
const env=()=>({GITHUB_REPOSITORY:REPOSITORY,GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW:'Discovery Radar capture shadow',GITHUB_WORKFLOW_REF:`${REPOSITORY}/${WORKFLOW}@refs/heads/main`,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40)});
function report(healthy=false) {
  return {version:1,publicationAuthorized:false,rawSourceBodyPersistedBytes:0,
    run:{runId:'123',attempt:1,headSha:'a'.repeat(40),startedAt:at,completedAt:later},
    health:healthy?'ok':'degraded',seenState:healthy?'ok':'cold-start',
    importedState:healthy?{artifactId:90,runId:'122',attempt:1,kind:'rolling',stateDigest:'sha256:'+'b'.repeat(64)}:null,
    githubRetentionDays:90,retentionCapability:'ok',checkpoint:{date:'2026-10-08',retentionDays:90,existingSuccessful:false,uploadPlanned:true},failures:[],
    sourceHealth:config.sources.map(source=>({sourceId:source.id,status:'empty',itemCount:0,classifications:{},requests:1}))};
}
const validate=value=>validateReport(value,expectedBinding(env()));
const render=value=>renderReport(validate(value));
function fileFixture(t,value=report()) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'radar-health-fixture-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const rolling=path.join(temp,'discovery-radar','rolling');fs.mkdirSync(rolling,{recursive:true});
  const file=path.join(rolling,'capture-report.json'),summary=path.join(temp,'summary.md');
  fs.writeFileSync(file,JSON.stringify(value));
  return {temp,rolling,file,summary,env:{...env(),RUNNER_TEMP:temp,GITHUB_STEP_SUMMARY:summary}};
}

for (const [status,code] of [[403,'http-forbidden'],[429,'http-rate-limited'],[500,'http-server-error'],[503,'http-server-error'],[599,'http-server-error'],[400,'http-status'],[404,'http-status']]) test(`HTTP${status} is ${code}, preserves failed-source cursor, and never authorizes publication`,async()=>{
  const state=emptyState(),old='2026-10-08T10:00:00.000Z';state.sourceCursors=Object.fromEntries(config.sources.map(s=>[s.id,old]));
  const fetcher=createSourceFetcher({resolver:async()=>[{address:'8.8.8.8',family:4}],transport:async()=>({status,headers:{'content-type':'application/json'},body:Buffer.from('untrusted response body')}),clock:()=>new Date(later)});
  await assert.rejects(()=>fetcher.fetchBody(config.sources[0].endpoint,config.sources[0]),{message:code});
  const result=await capture(config,{state,imported:null,seenState:'cold-start',failures:[]},{...fetcher,clock:()=>new Date(later)});
  assert.equal(result.sourceHealth.length,3);assert.ok(result.sourceHealth.every(s=>s.status==='error'&&s.code===code));
  assert.deepEqual(result.state.sourceCursors,state.sourceCursors);assert.equal(result.observations.length,0);
  const value=report();value.sourceHealth=result.sourceHealth;const output=render(value);
  assert.ok(output.includes(code));assert.ok(output.includes('Publication is **not authorized**'));assert.ok(!output.includes('untrusted response body'));
});
for (const code of ['timeout','transport-error','parser-drift','xml-tag','https-equivalence-needs-review']) test(`${code} stays distinct and source cursor remains unchanged`,async()=>{
  const state=emptyState();state.sourceCursors['anthropic-news']='2026-10-08T09:00:00.000Z';
  const result=await capture(config,{state,imported:null,seenState:'cold-start',failures:[]},{stats:{requests:0,bytes:0},clock:()=>new Date(later),fetchBody:async()=>{throw new Error(code);}});
  assert.equal(result.sourceHealth[2].code,code);assert.equal(result.state.sourceCursors['anthropic-news'],state.sourceCursors['anthropic-news']);
  const value=report();value.sourceHealth=result.sourceHealth;assert.ok(render(value).includes(code));
});
test('HTTP200 source body processing is unchanged',async()=>{
  const fetcher=createSourceFetcher({resolver:async()=>[{address:'8.8.8.8',family:4}],transport:async()=>({status:200,headers:{'content-type':'application/json'},body:Buffer.from('[1]')}),clock:()=>new Date(later)});
  assert.equal((await fetcher.fetchBody(config.sources[0].endpoint,config.sources[0])).body,'[1]');
});
test('healthy technical status remains explicitly editorial NOT PROVEN with no warning',t=>{
  const f=fileFixture(t,report(true));assert.equal(summarize(f.env),null);
  const text=fs.readFileSync(f.summary,'utf8');assert.ok(text.includes('Technical health: **ok**'));assert.ok(text.includes('Editorial coverage: **NOT PROVEN**'));assert.ok(text.includes('Publication is **not authorized**'));
});
test('cold start emits fixed warning and technical health/continuity table',t=>{
  const f=fileFixture(t);assert.equal(summarize(f.env),WARNING);
  const text=fs.readFileSync(f.summary,'utf8');assert.ok(text.includes('**cold-start**'));assert.ok(text.includes('| hn-new | empty | - | 0 | 0 | 1 |'));
});
test('checkpoint gap, degraded retention and source errors independently warn',t=>{
  for (const mode of ['gap','retention','source']) {
    const value=report(true);
    if(mode==='gap'){value.seenState='recovered-gap';value.health='degraded';value.importedState.kind='checkpoint';}
    else if(mode==='retention'){value.githubRetentionDays=30;value.retentionCapability='degraded';value.checkpoint.retentionDays=30;}
    else {value.health='degraded';value.sourceHealth[1]={sourceId:'kagoshima-new',status:'error',itemCount:3,classifications:{'needs-review':7},requests:1,code:'https-equivalence-needs-review'};}
    const f=fileFixture(t,value);assert.equal(summarize(f.env),WARNING);
    assert.ok(fs.readFileSync(f.summary,'utf8').includes('NOT PROVEN'));
  }
});
test('W0 optional migration fields validate and render without state/schema dependencies',t=>{
  const value=report(true);value.health='degraded';value.stateMigrations=[{sourceId:'kagoshima-new',action:'preserved-ledger-cleared-cursor'}];value.futurePresentation={title:'secret title'};
  const f=fileFixture(t,value);assert.equal(summarize(f.env),WARNING);assert.ok(fs.readFileSync(f.summary,'utf8').includes('Source migrations: 1.'));
  assert.ok(!fs.readFileSync(f.summary,'utf8').includes('secret title'));
  value.stateMigrations=[];value.health='ok';assert.equal(validate(value).degraded,false);
});
test('malicious error/title/classification strings never reach Markdown or annotation',t=>{
  const payload='::error::secret\n<script>alert(1)</script>|[malicious](https://evil.invalid)';
  const value=report();value.title=payload;value.sourceHealth[1]={sourceId:'kagoshima-new',status:'error',code:payload,title:payload,itemCount:0,requests:1,classifications:{[payload]:2}};
  value.failures=[{kind:'rolling',code:payload}];
  const f=fileFixture(t,value);assert.equal(summarize(f.env),WARNING);const text=fs.readFileSync(f.summary,'utf8');
  assert.ok(text.includes('unclassified-error'));assert.ok(!text.includes('secret'));assert.ok(!text.includes('<script>'));assert.ok(!WARNING.includes(payload));
});
for (const [name,mutate] of [
  ['version',v=>v.version=2],['publication',v=>v.publicationAuthorized=true],['raw body persistence',v=>v.rawSourceBodyPersistedBytes=1],
  ['missing source',v=>v.sourceHealth.pop()],['unknown source',v=>v.sourceHealth[0].sourceId='foreign'],['duplicate source',v=>v.sourceHealth[1]=v.sourceHealth[0]],
  ['unknown status',v=>v.sourceHealth[0].status='good'],['source oversized count',v=>v.sourceHealth[0].itemCount=2],['negative requests',v=>v.sourceHealth[0].requests=-1],
  ['missing error code',v=>v.sourceHealth[0].status='error'],['source code wrong type',v=>{v.sourceHealth[0].status='error';v.sourceHealth[0].code={};}],
  ['healthy source error',v=>{v.health='ok';v.sourceHealth[0].status='error';v.sourceHealth[0].code='timeout';}],
  ['healthy coldstart',v=>v.health='ok'],['negative classification',v=>v.sourceHealth[0].classifications.foo=-1],
  ['needs-review without error',v=>v.sourceHealth[0].classifications['needs-review']=1],['ok without items',v=>v.sourceHealth[0].status='ok'],
  ['empty with items',v=>v.sourceHealth[1].itemCount=1],['skipped with requests',v=>v.sourceHealth[1].status='skipped-not-due'],
  ['bad retention range',v=>v.githubRetentionDays=91],['retention contradiction',v=>v.retentionCapability='degraded'],
  ['checkpoint retention contradiction',v=>v.checkpoint.retentionDays=14],['unknown Seen',v=>v.seenState='fresh'],
  ['checkpoint invalid month',v=>v.checkpoint.date='2026-99-99'],['checkpoint invalid day',v=>v.checkpoint.date='2026-02-30'],
  ['checkpoint upload contradiction',v=>v.checkpoint.existingSuccessful=true],
  ['partial HTTP failure',v=>Object.assign(v.sourceHealth[1],{status:'error',code:'http-forbidden',itemCount:3})],
  ['partial parser failure',v=>Object.assign(v.sourceHealth[1],{status:'error',code:'parser-drift',itemCount:3})],
  ['partial needs-review without review count',v=>Object.assign(v.sourceHealth[1],{status:'error',code:'https-equivalence-needs-review',itemCount:3})],
  ['coldstart imported pointer',v=>v.importedState={}],['run mismatch',v=>v.run.runId='124'],['attempt mismatch',v=>v.run.attempt=2],['head mismatch',v=>v.run.headSha='b'.repeat(40)],
  ['reversed producer time',v=>v.run.startedAt='2026-10-09T00:00:00Z'],['missing producer time',v=>delete v.run.completedAt],
  ['unknown migration source',v=>v.stateMigrations=[{sourceId:'foreign',action:'reset-source'}]],['unknown migration action',v=>v.stateMigrations=[{sourceId:'hn-new',action:'merged-identities'}]],
  ['duplicate migration source',v=>v.stateMigrations=[{sourceId:'hn-new',action:'reset-source'},{sourceId:'hn-new',action:'reset-source'}]],
  ['oversized failures',v=>v.failures=Array.from({length:3},()=>({kind:'rolling',code:'timeout'}))]
]) test(`report ${name} fails fixed before summary output`,t=>{
  const value=report();mutate(value);const f=fileFixture(t,value);assert.throws(()=>summarize(f.env),/radar-health-invalid-report/);assert.equal(fs.existsSync(f.summary),false);
});
for (const [field,value] of [
  ['GITHUB_REPOSITORY','foreign/repo'],['GITHUB_REF','refs/heads/feature'],['GITHUB_WORKFLOW','Other workflow'],
  ['GITHUB_WORKFLOW_REF',`${REPOSITORY}/${WORKFLOW}@refs/heads/feature`],['GITHUB_RUN_ID','0'],['GITHUB_RUN_ID','bad\n::error::secret'],['GITHUB_RUN_ATTEMPT','0'],['GITHUB_RUN_ATTEMPT','1.5'],['GITHUB_SHA','B'.repeat(40)]
]) test(`environment rejects ${field} mismatch with fixed error`,()=>{const current=env();current[field]=value;assert.throws(()=>expectedBinding(current),/radar-health-invalid-environment/);});
test('missing file, directory, oversized report, invalid UTF8 and malformed JSON fail fixed',t=>{
  const f=fileFixture(t);
  assert.throws(()=>readReport(path.join(f.temp,'missing')),/radar-health-invalid-report/);assert.throws(()=>readReport(f.rolling),/radar-health-invalid-report/);
  for (const content of [Buffer.alloc(REPORT_BUDGET+1,32),Buffer.from([0xc0,0xaf]),Buffer.from('{')]){fs.writeFileSync(f.file,content);assert.throws(()=>readReport(f.file),/radar-health-invalid-report/);}
  assert.equal(fs.existsSync(f.summary),false);
});
test('report symlink to regular file is rejected',{skip:process.platform==='win32'},t=>{
  const f=fileFixture(t),other=path.join(f.temp,'other.json');fs.renameSync(f.file,other);fs.symlinkSync(other,f.file);assert.throws(()=>readReport(f.file),/radar-health-invalid-report/);
});
test('runner report-directory symlink is rejected',t=>{
  const f=fileFixture(t);
  const alternate=path.join(f.temp,'alternate');fs.renameSync(f.rolling,alternate);fs.symlinkSync(alternate,f.rolling,'junction');assert.throws(()=>summarize(f.env),/radar-health-invalid-report/);
});
test('CLI invalid report emits only fixed failure and cannot leak malformed exception text',t=>{
  const f=fileFixture(t);fs.writeFileSync(f.file,'{ "secret evil text');
  const script=fileURLToPath(new URL('../scripts/discovery-radar-health.mjs',import.meta.url));
  try { execFileSync(process.execPath,[script],{env:{...process.env,...f.env},encoding:'utf8',stdio:'pipe'});assert.fail('expected CLI failure'); }
  catch(error){assert.equal(error.status,1);assert.equal(error.stdout.trim(),FAILURE);assert.equal(error.stderr,'');assert.ok(!error.stdout.includes('secret'));}
  assert.equal(fs.existsSync(f.summary),false);
});
test('workflow adds exactly one diagnostics step after capture before rolling upload with unchanged permissions and schedules',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/discovery-radar-shadow.yml',import.meta.url),'utf8');
  assert.equal((workflow.match(/node scripts\/discovery-radar-health\.mjs/g)||[]).length,1);
  const captureAt=workflow.indexOf('run: node scripts/discovery-radar.mjs capture'),healthAt=workflow.indexOf('run: node scripts/discovery-radar-health.mjs'),uploadAt=workflow.indexOf('uses: actions/upload-artifact@v4');
  assert.ok(captureAt<healthAt&&healthAt<uploadAt);assert.ok(workflow.includes("cron: '17 * * * *'"));assert.ok(workflow.includes('contents: read'));assert.ok(workflow.includes('actions: read'));assert.ok(!workflow.includes('contents: write'));assert.ok(workflow.includes('cancel-in-progress: false'));assert.ok(workflow.includes('timeout-minutes: 10'));
});
