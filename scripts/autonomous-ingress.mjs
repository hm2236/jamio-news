import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDate} from './contract.mjs';
import {canonical, loadRepository, readDraft, planDraft, serialize} from './production.mjs';
import {createContext, fence, editionState, evaluateDraft, githubJSON} from './autonomous.mjs';
import {digest, jst} from './source-research.mjs';

export const inbox = JSON.parse(fs.readFileSync(new URL('../config/autonomous-ingress.json',import.meta.url),'utf8'));
const root = fileURLToPath(new URL('../',import.meta.url));
const matches = (value,pattern) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
const id = value => matches(value,/^[1-9][0-9]{0,19}$/);
const attempt = value => Number.isSafeInteger(value) && value > 0;
const attemptID = value => matches(value,/^[a-z0-9][a-z0-9-]{15,63}$/);
class IngressRejection extends Error {}
const fail = message => { throw new IngressRejection(message); };
// Reuse fixed repository GET validation with explicit fresh reads for every fence.
export const ingressJSON = (endpoint,options={}) => githubJSON(endpoint,{...options,
  request: (url,init) => (options.request || fetch)(url,{...init,cache:'no-store'})});
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) fail('Malformed header fields');
}
function utf8(text) {
  if (typeof text !== 'string' || Buffer.from(text,'utf8').toString('utf8') !== text || text.includes('\0')) fail('Invalid UTF-8 payload');
  return Buffer.byteLength(text,'utf8');
}
function header(body, marker, chunk) {
  if (typeof body !== 'string' || !body.startsWith(marker+'\n')) fail('Malformed marker');
  const rest = body.slice(marker.length+1), end = rest.indexOf('\n');
  const line = end < 0 ? rest : rest.slice(0,end);
  if (utf8(line) > inbox.limits.headerBytes) fail('Header size limit');
  let value;
  try { value = JSON.parse(line); } catch { fail('Malformed JSON header'); }
  // Compact JSON is the exact wire grammar. This also rejects duplicate keys.
  if (JSON.stringify(value) !== line) fail('Header must be compact JSON without duplicate keys');
  if (chunk) {
    if (end < 0 || rest[end+1] !== '\n') fail('Chunk requires one blank line');
    return {value,payload:rest.slice(end+2)};
  }
  if (end >= 0 && rest.slice(end) !== '\n') fail('Seal cannot carry payload');
  return value;
}
export function parseSeal(body) {
  const value = header(body,inbox.sealMarker,false);
  exact(value,['version','attemptId','date','slug','variant','baseSha','collectorRunId','collectorRunAttempt','chunkCommentIds']);
  if (value.version !== 1 || !attemptID(value.attemptId) || !isDate(value.date) ||
      value.slug !== value.date+'-morning' || value.variant !== 'morning' ||
      !matches(value.baseSha,/^[a-f0-9]{40}$/) ||
      !id(value.collectorRunId) || !attempt(value.collectorRunAttempt)) fail('Invalid seal identity');
  if (!Array.isArray(value.chunkCommentIds) || value.chunkCommentIds.length < 7 ||
      value.chunkCommentIds.length > inbox.limits.comments || !value.chunkCommentIds.every(id)) fail('Invalid chunk comment IDs or comment limit');
  if (new Set(value.chunkCommentIds).size !== value.chunkCommentIds.length) fail('Duplicate comment ID');
  return value;
}
export function parseChunk(body, seal) {
  const {value,payload} = header(body,inbox.chunkMarker,true);
  exact(value,['version','attemptId','file','part','parts']);
  if (value.version !== 1 || value.attemptId !== seal.attemptId) fail('Mixed attempt IDs');
  if (!attempt(value.part) || !attempt(value.parts) || value.part > value.parts || value.parts > inbox.limits.parts) fail('Invalid part numbering or part limit');
  if (typeof value.file !== 'string' || !(
    ['edition.md','editorial.json'].includes(value.file) ||
    matches(value.file,new RegExp('^articles/'+seal.slug+'-[a-z0-9][a-z0-9-]{0,63}\\.md$')))) fail('Forbidden logical path');
  if (!utf8(payload) || utf8(payload) > inbox.limits.partBytes) fail('Part size limit');
  return {...value,payload};
}
export function eligibleEvent(event, eventName) {
  return eventName === 'issue_comment' && event?.action === 'created' &&
    event.repository?.full_name === inbox.repository && event.repository?.default_branch === 'main' &&
    event.issue?.number === inbox.issue && !event.issue?.pull_request &&
    event.comment?.user?.id === inbox.actorId && event.sender?.id === inbox.actorId &&
    event.comment?.author_association === inbox.association &&
    typeof event.comment.body === 'string' && event.comment.body.startsWith(inbox.sealMarker+'\n');
}
function commentSnapshot(comment) {
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) && Number.isFinite(Date.parse(value));
  if (!Number.isSafeInteger(comment?.id) || comment.id < 1 ||
      comment.user?.id !== inbox.actorId || comment.author_association !== inbox.association ||
      comment.issue_url !== 'https://api.github.com/repos/'+inbox.repository+'/issues/'+inbox.issue ||
      !timestamp(comment.created_at) || comment.created_at !== comment.updated_at || typeof comment.body !== 'string') fail('Unauthorized, wrong inbox or edited comment');
  return {id:comment.id,userId:comment.user.id,association:comment.author_association,
    issueURL:comment.issue_url,createdAt:comment.created_at,updatedAt:comment.updated_at,body:comment.body};
}
async function readInbox(get) {
  const comments = [];
  for (let page=1;page<=inbox.limits.inboxPages;page++) {
    const rows = await get('/issues/'+inbox.issue+'/comments?per_page=100&page='+page);
    if (!Array.isArray(rows)) fail('Invalid inbox listing');
    comments.push(...rows);
    if (rows.length < 100) return comments;
  }
  fail('Inbox scan limit; owner review required');
}
async function uniqueSeal(get, seal, sealId) {
  const comments = await readInbox(get);
  // All well-formed authorized seals for the attempt are observable collisions,
  // including edited ones. A deleted seal cannot provide a durable replay ledger.
  const matches = comments.filter(c=>{
    if (c.user?.id !== inbox.actorId || c.author_association !== inbox.association) return false;
    try { return parseSeal(c.body).attemptId === seal.attemptId; } catch { return false; }
  });
  if (matches.length !== 1 || String(matches[0].id) !== String(sealId)) fail('Multiple or missing seals for attempt');
}
export async function collectorBinding(checkout, seal, {get=ingressJSON, now=()=>new Date()}={}) {
  const run = await get('/actions/runs/'+seal.collectorRunId);
  if (String(run.id) !== seal.collectorRunId || run.repository?.full_name !== inbox.repository ||
      run.path !== inbox.collectorWorkflow || !['schedule','workflow_dispatch'].includes(run.event) ||
      run.head_branch !== 'main' || run.head_sha !== seal.baseSha ||
      run.status !== 'completed' || run.conclusion !== 'success' || run.run_attempt !== seal.collectorRunAttempt) fail('Collector workflow, SHA, status or current attempt mismatch');
  const repository = loadRepository(checkout);
  const prior = repository.editions.filter(e=>e.kind==='daily' && Date.parse(e.published)<Date.parse(run.created_at))
    .sort((a,b)=>Date.parse(b.published)-Date.parse(a.published))[0];
  const context = createContext({runId:run.id,attempt:run.run_attempt,createdAt:run.created_at,
    baseSha:seal.baseSha,windowStart:prior?.published || jst(Date.parse(run.created_at)-86400000)});
  if (context.date !== seal.date || context.slug !== seal.slug) fail('Collector date/slug mismatch');
  fence(context,context,now());
  return {run,context};
}
export async function selectCollectorArtifact(seal, binding, {get=ingressJSON}={}) {
  const name = 'morning-shadow-'+seal.collectorRunId+'-'+seal.collectorRunAttempt;
  const candidates = [];
  for (let page=1;page<=inbox.limits.inboxPages;page++) {
    const response = await get('/actions/runs/'+seal.collectorRunId+'/artifacts?per_page=100&page='+page);
    if (!Array.isArray(response.artifacts)) fail('Invalid collector artifact listing');
    candidates.push(...response.artifacts.filter(a=>a.name===name));
    if (response.artifacts.length < 100) break;
    if (page === inbox.limits.inboxPages) fail('Artifact scan limit');
  }
  const artifact = candidates[0];
  if (candidates.length !== 1 || !Number.isSafeInteger(artifact.id) || artifact.id < 1 ||
      artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 ||
      artifact.size_in_bytes > inbox.limits.artifactBytes ||
      artifact.workflow_run?.id !== binding.run.id || artifact.workflow_run?.head_sha !== seal.baseSha ||
      !Number.isFinite(Date.parse(artifact.created_at)) ||
      Date.parse(artifact.created_at) < Date.parse(binding.run.run_started_at || binding.run.created_at)) fail('Collector artifact missing, ambiguous, expired or oversized');
  return {id:artifact.id,name,runId:seal.collectorRunId,runAttempt:seal.collectorRunAttempt,
    baseSha:seal.baseSha,sizeBytes:artifact.size_in_bytes,createdAt:artifact.created_at};
}
async function mainFence(checkout, seal, runtime, get, now) {
  const main = await get('/git/ref/heads/main');
  const head = execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim();
  if (main.ref !== 'refs/heads/main' || main.object?.type !== 'commit' || main.object?.sha !== seal.baseSha ||
      head !== seal.baseSha || runtime.sha !== head || runtime.ref !== 'refs/heads/main' ||
      jst(now()).slice(0,10) !== seal.date) fail('Stale main, checkout or JST date');
}
async function conflicts(checkout, seal, get) {
  const branch = await get('/git/ref/heads/daily/'+seal.slug,{allow404:true});
  const prs = await get('/pulls?state=open&head=hm2236:daily/'+seal.slug+'&per_page=100');
  if (!Array.isArray(prs) || editionState(loadRepository(checkout),seal,{branchExists:!!branch,pullRequests:prs}) !== 'research') fail('Existing edition or active daily candidate conflict');
}
async function start(checkout,event,runtime,{get,now}) {
  if (!eligibleEvent(event,runtime.eventName)) fail('Ineligible ingress event');
  if (!id(String(runtime.runId)) || !attempt(runtime.runAttempt)) fail('Invalid ingress run');
  const eventSeal = commentSnapshot(event.comment);
  const seal = parseSeal(eventSeal.body);
  await mainFence(checkout,seal,runtime,get,now);
  const run = await get('/actions/runs/'+runtime.runId);
  if (String(run.id) !== String(runtime.runId) || run.repository?.full_name !== inbox.repository ||
      run.path !== inbox.workflow || run.event !== 'issue_comment' || run.head_branch !== 'main' ||
      run.head_sha !== seal.baseSha || run.run_attempt !== runtime.runAttempt) fail('Untrusted ingress workflow run');
  const issue = await get('/issues/'+inbox.issue);
  if (issue.number !== inbox.issue || issue.pull_request ||
      issue.url !== 'https://api.github.com/repos/'+inbox.repository+'/issues/'+inbox.issue) fail('Wrong inbox issue');
  const initialSeal = commentSnapshot(await get('/issues/comments/'+event.comment.id));
  if (canonical(initialSeal) !== canonical(eventSeal)) fail('Seal differs from triggering event');
  await uniqueSeal(get,seal,initialSeal.id);
  await conflicts(checkout,seal,get);
  const binding = await collectorBinding(checkout,seal,{get,now});
  const collector = await selectCollectorArtifact(seal,binding,{get});
  return {seal,initialSeal,binding,collector};
}
export async function prepareIngress(checkout,event,runtime,{get=ingressJSON,now=()=>new Date()}={}) {
  return (await start(checkout,event,runtime,{get,now})).collector;
}
export function readCollectorReport(folder) {
  if (fs.lstatSync(folder).isSymbolicLink() || !fs.lstatSync(folder).isDirectory() ||
      fs.readdirSync(folder).join(',') !== 'report.json') fail('Collector artifact must contain only report.json');
  const file = path.join(folder,'report.json'), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > inbox.limits.reportBytes) fail('Collector report size/type limit');
  const bytes = fs.readFileSync(file);
  let report;
  try { report = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { fail('Invalid collector report JSON/UTF-8'); }
  return report;
}
export function reconstruct(chunks, seal) {
  const files = new Map(); let bytes = 0;
  for (const chunk of chunks) {
    bytes += utf8(chunk.payload);
    if (bytes > inbox.limits.packageBytes) fail('Package size limit');
    let file = files.get(chunk.file);
    if (!file) { file = {parts:chunk.parts,values:new Map()}; files.set(chunk.file,file); }
    if (file.parts !== chunk.parts || file.values.has(chunk.part)) fail('Duplicate logical path/part or inconsistent parts');
    file.values.set(chunk.part,chunk.payload);
  }
  if (files.size !== 7 || !files.has('edition.md') || !files.has('editorial.json') ||
      [...files.keys()].filter(f=>f.startsWith('articles/')).length !== 5) fail('Exactly five articles, edition and editorial required');
  return new Map([...files].map(([name,file])=>{
    if (file.values.size !== file.parts) fail('Missing file part');
    return [name,Array.from({length:file.parts},(_,i)=>file.values.get(i+1) ?? fail('Missing file part')).join('')];
  }));
}
export async function validateIngress(checkout,event,runtime,{get=ingressJSON,now=()=>new Date(),loadReport,expectedCollector}={}) {
  const {seal,initialSeal,binding,collector} = await start(checkout,event,runtime,{get,now});
  // Pins the artifact selected before download to the independently repeated API check.
  if (!loadReport || !expectedCollector || canonical(collector) !== canonical(expectedCollector)) fail('Downloaded collector reference mismatch');
  const initialChunks = [], chunks = [];
  for (const commentId of seal.chunkCommentIds) {
    const comment = commentSnapshot(await get('/issues/comments/'+commentId));
    if (String(comment.id) !== commentId) fail('Unknown chunk ID');
    if (Date.parse(comment.createdAt) > Date.parse(initialSeal.createdAt) ||
        (comment.createdAt === initialSeal.createdAt && comment.id >= initialSeal.id)) fail('Chunk must precede seal');
    initialChunks.push(comment);
    chunks.push(parseChunk(comment.body,seal));
  }
  const files = reconstruct(chunks,seal);
  let editorial;
  try { editorial = JSON.parse(files.get('editorial.json')); } catch { fail('Invalid editorial JSON'); }
  exact(editorial,['version','stories']);
  if (editorial.version !== 1 || !Array.isArray(editorial.stories) || editorial.stories.length !== 5) fail('Invalid editorial structure');
  const report = await loadReport(collector);
  if (report.version !== 1 || report.mode !== 'shadow' || report.publicationAuthorized !== false ||
      canonical(report.context) !== canonical(binding.context)) fail('Collector report context mismatch');
  // Only a private temporary draft is materialized. Never call applyDraft or any Git mutation.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'jamio-ingress-'));
  try {
    const draft = path.join(temporary,seal.slug);
    fs.mkdirSync(path.join(draft,'articles'),{recursive:true});
    for (const [name,text] of files) if (name !== 'editorial.json') fs.writeFileSync(path.join(draft,name),text,{flag:'wx'});
    fs.writeFileSync(path.join(draft,'prices.json'),'[]\n',{flag:'wx'});
    const bundle = readDraft(draft);
    const evidence = {version:1,context:binding.context,reportDigest:digest(canonical(report)),
      packageDigest:digest(canonical(bundle)),stories:editorial.stories};
    const evaluation = evaluateDraft(checkout,report,draft,evidence,binding.context,now());
    const plan = planDraft(checkout,draft);
    const expectedFiles = ['content/editions/'+seal.slug+'.md',...[...files.keys()].filter(f=>f.startsWith('articles/')).map(f=>'content/'+f)].sort();
    if (canonical(plan.writes.map(w=>w.file).sort()) !== canonical(expectedFiles)) fail('Package must be exactly six new content files; no updates or prices');
    const normalizedDraft = Object.fromEntries([
      ['edition.md',serialize(bundle.edition)],['prices.json','[]\n'],
      ...bundle.articles.map(a=>['articles/'+a.slug+'.md',serialize(a)])
    ]);
    for (const comment of [initialSeal,...initialChunks]) {
      if (canonical(commentSnapshot(await get('/issues/comments/'+comment.id))) !== canonical(comment)) fail('Comment altered during validation');
    }
    await uniqueSeal(get,seal,initialSeal.id);
    await conflicts(checkout,seal,get);
    const finalBinding = await collectorBinding(checkout,seal,{get,now});
    if (canonical(finalBinding) !== canonical(binding) ||
        canonical(await selectCollectorArtifact(seal,finalBinding,{get})) !== canonical(collector)) fail('Collector altered during validation');
    await mainFence(checkout,seal,runtime,get,now);
    const validatedAt = now();
    fence(binding.context,finalBinding.context,validatedAt);
    const receipt = {contract:'jamio-autonomous-package-ingress',version:1,status:'validated',
      workflow:inbox.workflow,runId:String(runtime.runId),runAttempt:runtime.runAttempt,
      repository:inbox.repository,inboxIssue:inbox.issue,sealCommentId:String(initialSeal.id),producerActorId:inbox.actorId,
      attemptId:seal.attemptId,date:seal.date,slug:seal.slug,variant:'morning',expectedBaseSha:seal.baseSha,
      collectorRunId:seal.collectorRunId,collectorRunAttempt:seal.collectorRunAttempt,collectorArtifactId:collector.id,
      reportDigest:evidence.reportDigest,packageDigest:evidence.packageDigest,editionUrl:evaluation.editionUrl,
      editionDigest:evaluation.digest,validatedFiles:expectedFiles,validatedAt:jst(validatedAt),publicationAuthorized:false};
    return {artifactName:'validated-package-'+initialSeal.id+'-'+runtime.runId+'-'+runtime.runAttempt,
      receipt,evidence,collector,normalizedDraft};
  } finally {
    if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir())) fail('Unsafe temporary cleanup');
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}
export function saveValidated(output,result) {
  // Fresh output directory, exclusive files; no partial output is eligible for upload on failure.
  fs.mkdirSync(output);
  const draft = path.join(output,'draft',result.receipt.slug);
  fs.mkdirSync(path.join(draft,'articles'),{recursive:true});
  for (const [name,text] of Object.entries(result.normalizedDraft)) fs.writeFileSync(path.join(draft,name),text,{flag:'wx'});
  for (const name of ['receipt','evidence','collector']) fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(result[name],null,2)+'\n',{flag:'wx'});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command,...args] = process.argv.slice(2);
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
    const runtime = {eventName:process.env.GITHUB_EVENT_NAME,runId:process.env.GITHUB_RUN_ID,
      runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT),sha:process.env.GITHUB_SHA,ref:process.env.GITHUB_REF};
    if (process.env.GITHUB_REPOSITORY !== inbox.repository) fail('Wrong repository runtime');
    if (command === 'prepare' && args.length === 1) {
      const collector = await prepareIngress(root,event,runtime);
      fs.writeFileSync(args[0],JSON.stringify(collector)+'\n',{flag:'wx'});
      fs.appendFileSync(process.env.GITHUB_OUTPUT,'artifact-id='+collector.id+'\ncollector-run-id='+collector.runId+'\n');
    } else if (command === 'validate' && args.length === 3) {
      const expectedCollector = JSON.parse(fs.readFileSync(args[0],'utf8'));
      const result = await validateIngress(root,event,runtime,{expectedCollector,loadReport:()=>readCollectorReport(args[1])});
      saveValidated(args[2],result);
      fs.appendFileSync(process.env.GITHUB_OUTPUT,'artifact-name='+result.artifactName+'\n');
      console.log('JAMIO_PACKAGE_INGRESS '+JSON.stringify(result.receipt));
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '## Package ingress shadow\n\nValidated; publication authorized: false. Consume the immutable artifact and receipt, never mutable inbox comments. Writer remains disabled.\n');
    } else fail('Usage: autonomous-ingress.mjs prepare <collector.json> | validate <collector.json> <download-folder> <new-output-folder>');
  } catch (error) {
    // Do not echo hostile payload, URLs, filesystem names, source text or credential-bearing exceptions.
    console.error('JAMIO_PACKAGE_INGRESS '+JSON.stringify({contract:'jamio-autonomous-package-ingress',version:1,status:'rejected',publicationAuthorized:false,
      reason:error instanceof IngressRejection ? error.message : 'Validation or GitHub read failed'}));
    process.exitCode = 1;
  }
}
