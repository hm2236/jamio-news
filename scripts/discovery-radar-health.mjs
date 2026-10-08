import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPORT_BUDGET = 512 * 1024;
export const WARNING = '::warning::Discovery Radar coverage-insufficient/unproven: inspect shadow diagnostics. Technical success preserves the artifact chain; editorial coverage is NOT PROVEN and publication is not authorized.';
export const FAILURE = '::error::Discovery Radar health diagnostics failed validation; artifact upload is stopped.';
const REPOSITORY = 'hm2236/jamio-news';
const WORKFLOW = '.github/workflows/discovery-radar-shadow.yml';
const SOURCES = ['hn-new','kagoshima-new','anthropic-news'];
const statuses = ['ok','empty','skipped-not-due','error'];
const codeAllowlist = new Set([
  'http-forbidden','http-rate-limited','http-server-error','http-status','timeout','transport-error',
  'response-size','content-type','invalid-utf8','dns-policy','endpoint-policy','redirect-policy',
  'parser-drift','https-equivalence-needs-review','adapter-error','json-malformed','hn-list-shape',
  'hn-shape','hn-time','hn-url','hn-url-policy','source-time','field-bound','unknown-entity','invalid-entity',
  'feed-url-policy','html-url-policy','html-duplicate','collector-time',
  'xml-character','xml-entity','xml-namespace','xml-declaration','xml-field-bound','xml-text',
  'xml-comment','xml-cdata','xml-prolog','xml-tag','xml-unclosed','xml-attribute','xml-nested-item',
  'xml-structure-bound','xml-dialect','xml-field-structure','xml-dialect-structure','xml-item-bound',
  'xml-duplicate-field','xml-item-shape'
]);
const invalid = () => { throw new Error('radar-health-invalid-report'); };
const object = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value; };
const integer = (value,min=0,max=Number.MAX_SAFE_INTEGER) => { if (!Number.isSafeInteger(value) || value < min || value > max) invalid(); return value; };
const boundedCode = value => { if (typeof value !== 'string' || !value.length || value.length > 4096) invalid(); return codeAllowlist.has(value) ? value : 'unclassified-error'; };
const time = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) invalid(); return Date.parse(value); };

export function expectedBinding(env) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_WORKFLOW !== 'Discovery Radar capture shadow' || env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/${WORKFLOW}@refs/heads/main` || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '') || !Number.isSafeInteger(Number(env.GITHUB_RUN_ATTEMPT)) || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('radar-health-invalid-environment');
  return {runId:env.GITHUB_RUN_ID,attempt:Number(env.GITHUB_RUN_ATTEMPT),headSha:env.GITHUB_SHA};
}
export function readReport(file) {
  let fd;
  try {
    const before = fs.lstatSync(file);
    if (before.isSymbolicLink() || !before.isFile() || before.size > REPORT_BUDGET) invalid();
    fd = fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > REPORT_BUDGET) invalid();
    // Read at most the budget plus one detection byte even if a file grows after the stat.
    const bytes = Buffer.alloc(REPORT_BUDGET+1);let size=0;
    while (size < bytes.length) { const n=fs.readSync(fd,bytes,size,bytes.length-size,null);if (!n) break;size+=n; }
    if (size > REPORT_BUDGET) invalid();
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
  } catch { invalid(); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function validateReport(report,expected) {
  object(report);object(expected);object(report.run);
  if (report.version !== 1 || report.publicationAuthorized !== false || report.rawSourceBodyPersistedBytes !== 0 || !['ok','degraded'].includes(report.health) || !['ok','cold-start','recovered-gap'].includes(report.seenState)) invalid();
  if (report.run.runId !== expected.runId || report.run.attempt !== expected.attempt || report.run.headSha !== expected.headSha || !/^[1-9][0-9]*$/.test(report.run.runId) || !/^[a-f0-9]{40}$/.test(report.run.headSha)) invalid();
  integer(report.run.attempt,1);
  if (time(report.run.startedAt) > time(report.run.completedAt)) invalid();
  integer(report.githubRetentionDays,1,90);
  if (report.retentionCapability !== (report.githubRetentionDays === 90 ? 'ok' : 'degraded')) invalid();
  object(report.checkpoint);
  if (report.checkpoint.retentionDays !== report.githubRetentionDays || typeof report.checkpoint.existingSuccessful !== 'boolean' || typeof report.checkpoint.uploadPlanned !== 'boolean' || !/^\d{4}-\d{2}-\d{2}$/.test(report.checkpoint.date || '')) invalid();
  if (!Number.isFinite(Date.parse(report.checkpoint.date)) || new Date(report.checkpoint.date).toISOString().slice(0,10) !== report.checkpoint.date) invalid();
  if (report.checkpoint.existingSuccessful === report.checkpoint.uploadPlanned) invalid();
  if (report.seenState === 'cold-start') { if (report.importedState !== null) invalid(); }
  else {
    const imported=object(report.importedState);integer(imported.artifactId,1);integer(imported.attempt,1);
    if (!/^[1-9][0-9]*$/.test(imported.runId || '') || !['rolling','checkpoint'].includes(imported.kind) || !/^sha256:[a-f0-9]{64}$/.test(imported.stateDigest || '') || imported.kind !== (report.seenState === 'ok' ? 'rolling' : 'checkpoint')) invalid();
  }
  if (!Array.isArray(report.failures) || report.failures.length > 2) invalid();
  for (const failure of report.failures) { object(failure);if (!['rolling','checkpoint'].includes(failure.kind)) invalid();boundedCode(failure.code); }
  if (!Array.isArray(report.sourceHealth) || report.sourceHealth.length !== SOURCES.length) invalid();
  const sources = new Map();
  for (const source of report.sourceHealth) {
    object(source);
    if (!SOURCES.includes(source.sourceId) || sources.has(source.sourceId) || !statuses.includes(source.status)) invalid();
    integer(source.itemCount,0,source.sourceId === 'hn-new' ? 1 : 20);integer(source.requests,0,1000000);object(source.classifications);
    if (Object.keys(source.classifications).length > 100) invalid();
    for (const count of Object.values(source.classifications)) integer(count,0,1000000);
    const needsReview = source.classifications['needs-review'] ?? 0;
    if (['empty','skipped-not-due'].includes(source.status) && source.itemCount !== 0 || source.status === 'skipped-not-due' && source.requests !== 0 || source.status === 'ok' && source.itemCount === 0 || needsReview && source.status !== 'error') invalid();
    const code = source.status === 'error' ? boundedCode(source.code) : '-';
    if (source.status === 'error' && source.itemCount > 0 && (code !== 'https-equivalence-needs-review' || needsReview === 0) || needsReview > 0 && code !== 'https-equivalence-needs-review') invalid();
    if (source.status !== 'error' && source.code !== undefined) invalid();
    sources.set(source.sourceId,{sourceId:source.sourceId,status:source.status,code,itemCount:source.itemCount,needsReview,requests:source.requests});
  }
  const migrations = report.stateMigrations ?? [];
  if (!Array.isArray(migrations) || migrations.length > SOURCES.length) invalid();
  const migrated = new Set();
  for (const migration of migrations) {
    object(migration);
    if (!SOURCES.includes(migration.sourceId) || migrated.has(migration.sourceId) || !['preserved-ledger-cleared-cursor','reset-source'].includes(migration.action)) invalid();
    migrated.add(migration.sourceId);
  }
  const degraded = report.health === 'degraded' || report.seenState !== 'ok' || report.retentionCapability === 'degraded' || report.failures.length > 0 || migrations.length > 0 || [...sources.values()].some(source=>source.status === 'error');
  if (report.health === 'ok' && (report.seenState !== 'ok' || report.failures.length || migrations.length || [...sources.values()].some(source=>source.status === 'error'))) invalid();
  return {health:report.health,seenState:report.seenState,retentionCapability:report.retentionCapability,githubRetentionDays:report.githubRetentionDays,migrationCount:migrations.length,degraded,sources:SOURCES.map(id=>sources.get(id))};
}
export function renderReport(validated) {
  const rows = validated.sources.map(source=>`| ${source.sourceId} | ${source.status} | ${source.code} | ${source.itemCount} | ${source.needsReview} | ${source.requests} |`).join('\n');
  return `## Discovery Radar shadow diagnostics\n\nTechnical health: **${validated.health}**. State continuity: **${validated.seenState}**. Recovery retention: **${validated.retentionCapability}** (${validated.githubRetentionDays} days). Source migrations: ${validated.migrationCount}.\n\n| Source | Status | Code | Accepted items | Needs review | Requests |\n| --- | --- | --- | ---: | ---: | ---: |\n${rows}\n\nEditorial coverage: **NOT PROVEN**. Publication is **not authorized**. Technical success preserves the artifact chain; these diagnostics do not grant editorial or publication approval.\n`;
}
export function summarize(env) {
  const expected=expectedBinding(env);
  if (!env.RUNNER_TEMP || !env.GITHUB_STEP_SUMMARY) throw new Error('radar-health-invalid-environment');
  const base=path.join(env.RUNNER_TEMP,'discovery-radar'),rolling=path.join(base,'rolling');
  for (const directory of [env.RUNNER_TEMP,base,rolling]) { let info;try { info=fs.lstatSync(directory); } catch { invalid(); } if (info.isSymbolicLink() || !info.isDirectory()) invalid(); }
  const validated=validateReport(readReport(path.join(rolling,'capture-report.json')),expected);
  // Validate everything before emitting any report-derived output.
  fs.appendFileSync(env.GITHUB_STEP_SUMMARY,renderReport(validated),'utf8');
  return validated.degraded ? WARNING : null;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv.length !== 2) throw new Error('radar-health-invalid-environment');const warning=summarize(process.env);if (warning) console.log(warning); }
  catch { console.log(FAILURE);process.exitCode=1; }
}
