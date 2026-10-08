import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isDate} from './contract.mjs';
import {canonical, loadRepository, readDraft, serialize} from './production.mjs';
import {editionState, evaluateDraft, fence, githubJSON, liveContext} from './autonomous.mjs';
import {digest, jst} from './source-research.mjs';

// Detached producer package ingress, SHADOW ONLY. Issue comments are hostile,
// mutable input: they are parsed as inert data, never executed, and never
// trusted for digests, paths, reports or publication. Success means
// "validated", never "published"; this module performs no repository write.
const root = fileURLToPath(new URL('../', import.meta.url));
export const config = JSON.parse(fs.readFileSync(new URL('../config/package-ingress.json', import.meta.url), 'utf8'));
export const CHUNK_MARKER = 'JAMIO_AUTONOMOUS_PACKAGE_CHUNK_V1';
export const SEAL_MARKER = 'JAMIO_AUTONOMOUS_PACKAGE_SEAL_V1';
export const LOG_MARKER = 'JAMIO_PACKAGE_INGRESS';
const CHUNK_KEYS = ['version', 'attemptId', 'file', 'part', 'parts'];
const SEAL_KEYS = ['version', 'attemptId', 'date', 'slug', 'variant', 'baseSha', 'collectorRunId', 'collectorRunAttempt', 'chunks'];
// Same shape as the existing Candidate-Attempt trailer: 16-64 lowercase alphanumerics/hyphens.
const ATTEMPT = /^[a-z0-9][a-z0-9-]{15,63}$/;
// The only producer paths. Everything else (prices, code, workflows, traversal) is rejected.
const FILE = /^(edition\.md|editorial\.json|articles\/[a-z0-9]+(?:-[a-z0-9]+)*\.md)$/;
const MAX_SEAL_BYTES = 16384;
const owner = config.repository.split('/')[0];
const inboxURL = `https://api.github.com/repos/${config.repository}/issues/${config.inboxIssue}`;

export class IngressError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
const reject = (code, message) => { throw new IngressError(code, message); };

function normalized(body, maxBytes, code) {
  if (typeof body !== 'string') reject(code);
  if (Buffer.byteLength(body) > maxBytes) reject(code === 'seal-malformed' ? code : 'part-too-large');
  const text = body.replace(/\r\n/g, '\n');
  if (/[\0\r]/.test(text)) reject(code);
  return text;
}
const firstLine = body => typeof body === 'string' ? body.replace(/\r\n/g, '\n').split('\n', 1)[0] : '';
// Exact one-line JSON in a fixed key order: rejects extra, missing, duplicate,
// reordered keys and any whitespace or escape variant.
function strictHeader(line, keys, code) {
  let value;
  try { value = JSON.parse(line); } catch { reject(code); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== keys.join() || JSON.stringify(value) !== line) reject(code);
  return value;
}

// CHUNK_MARKER \n {"version":1,"attemptId":..,"file":..,"part":n,"parts":m} \n \n <raw UTF-8 payload>
// One trailing newline of the payload is dropped; parts of one file are joined
// with "\n" and the file ends with "\n". Producers split files at line breaks.
export function parseChunk(body, limits = config.limits) {
  const text = normalized(body, limits.maxPartBytes + 1024, 'chunk-malformed');
  const first = text.indexOf('\n'), second = text.indexOf('\n', first + 1);
  if (first < 0 || second < 0 || text.slice(0, first) !== CHUNK_MARKER || text[second + 1] !== '\n') reject('chunk-malformed');
  const header = strictHeader(text.slice(first + 1, second), CHUNK_KEYS, 'chunk-malformed');
  const {version, attemptId, file, part, parts} = header;
  if (version !== 1 || typeof attemptId !== 'string' || !ATTEMPT.test(attemptId) || typeof file !== 'string' || !Number.isSafeInteger(part) || !Number.isSafeInteger(parts) || part < 1 || part > parts) reject('chunk-malformed');
  if (parts > limits.maxPartsPerFile) reject('too-many-parts');
  if (!FILE.test(file)) reject('path-forbidden');
  let payload = text.slice(second + 2);
  if (payload.endsWith('\n')) payload = payload.slice(0, -1);
  if (Buffer.byteLength(payload) > limits.maxPartBytes) reject('part-too-large');
  return {...header, payload};
}

// SEAL_MARKER \n {"version":1,"attemptId":..,"date":..,"slug":..,"variant":"morning","baseSha":..,
//   "collectorRunId":"..","collectorRunAttempt":n,"chunks":[ascending comment IDs]}
export function parseSeal(body, limits = config.limits) {
  const lines = normalized(body, MAX_SEAL_BYTES, 'seal-malformed').replace(/\n$/, '').split('\n');
  if (lines.length !== 2 || lines[0] !== SEAL_MARKER) reject('seal-malformed');
  const seal = strictHeader(lines[1], SEAL_KEYS, 'seal-malformed');
  const {version, attemptId, date, slug, variant, baseSha, collectorRunId, collectorRunAttempt, chunks} = seal;
  if (version !== 1 || typeof attemptId !== 'string' || !ATTEMPT.test(attemptId) || !isDate(date) || typeof slug !== 'string' || typeof variant !== 'string' || typeof baseSha !== 'string' || !/^[a-f0-9]{40}$/.test(baseSha) ||
    typeof collectorRunId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(collectorRunId) || !Number.isSafeInteger(collectorRunAttempt) || collectorRunAttempt < 1 ||
    !Array.isArray(chunks) || !chunks.length || !chunks.every(id => Number.isSafeInteger(id) && id > 0)) reject('seal-malformed');
  if (chunks.length > limits.maxChunks) reject('too-many-chunks');
  if (new Set(chunks).size !== chunks.length) reject('duplicate-chunk-id');
  if (chunks.some((id, i) => i && id < chunks[i - 1])) reject('chunk-order');
  if (variant !== config.variant) reject('variant-forbidden');
  if (slug !== `${date}-${variant}`) reject('slug-mismatch');
  return seal;
}

export function checkEvent(event, env = process.env) {
  if (env.GITHUB_REPOSITORY !== config.repository || env.GITHUB_EVENT_NAME !== 'issue_comment' || env.GITHUB_REF !== 'refs/heads/main' || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '')) reject('untrusted-workflow-context');
  const {action, issue, comment, repository} = event || {};
  if (action !== 'created' || repository?.full_name !== config.repository || !issue || !comment || !Number.isSafeInteger(comment.id) || comment.id < 1) reject('event-forbidden');
  if (issue.pull_request) reject('pull-request-comment');
  if (issue.number !== config.inboxIssue) reject('wrong-issue');
  if (comment.user?.id !== config.producerActorId) reject('wrong-actor');
  if (comment.author_association !== config.producerAssociation) reject('wrong-association');
  if (firstLine(comment.body) !== SEAL_MARKER) reject('not-a-seal');
  return comment;
}

function assertInboxComment(comment, kind) {
  if (!comment || !Number.isSafeInteger(comment.id) || typeof comment.body !== 'string') reject(`${kind}-unknown`);
  if (comment.issue_url !== inboxURL) reject('wrong-issue');
  if (comment.user?.id !== config.producerActorId) reject('wrong-actor');
  if (comment.author_association !== config.producerAssociation) reject('wrong-association');
  // Edit-free by contract. Any later edit is also caught by the final snapshot comparison.
  if (typeof comment.created_at !== 'string' || comment.created_at !== comment.updated_at) reject(`${kind}-edited`);
}
// Byte-for-byte and structural identity of a comment, for TOCTOU comparison.
const snapshot = c => ({id:c.id, issueUrl:c.issue_url, actorId:c.user?.id, association:c.author_association, createdAt:c.created_at, updatedAt:c.updated_at, bodyDigest:digest(String(c.body))});
const attemptOf = body => { try { return JSON.parse(body.replace(/\r\n/g, '\n').split('\n')[1]).attemptId; } catch { return undefined; } };
const authorized = c => c.user?.id === config.producerActorId && c.author_association === config.producerAssociation;

// Reconstructs exactly one allowed logical package from the referenced chunks.
export function assemblePackage(seal, sealComment, comments, {since, limits = config.limits, articleCount = config.articleCount} = {}) {
  const byId = new Map();
  for (const comment of comments) {
    if (byId.has(comment.id)) reject('duplicate-comment');
    byId.set(comment.id, comment);
  }
  if (!byId.has(sealComment.id) || canonical(snapshot(byId.get(sealComment.id))) !== canonical(snapshot(sealComment))) reject('seal-altered');
  // Deterministic replay/collision classification over authorized inbox comments in the window.
  for (const comment of comments) {
    if (comment.id === sealComment.id || !authorized(comment) || typeof comment.body !== 'string') continue;
    const marker = firstLine(comment.body);
    if (marker === SEAL_MARKER && attemptOf(comment.body) === seal.attemptId) reject('duplicate-seal');
    if (marker === CHUNK_MARKER && !seal.chunks.includes(comment.id) && attemptOf(comment.body) === seal.attemptId) reject('unreferenced-chunk');
  }
  const files = new Map(), chunks = [];
  for (const id of seal.chunks) {
    const comment = byId.get(id);
    if (!comment) reject('chunk-unknown');
    assertInboxComment(comment, 'chunk');
    if (id >= sealComment.id || Date.parse(comment.created_at) > Date.parse(sealComment.created_at)) reject('chunk-after-seal');
    if (since && Date.parse(comment.created_at) < Date.parse(since)) reject('chunk-predates-collector');
    if (firstLine(comment.body) !== CHUNK_MARKER) reject('chunk-malformed');
    const chunk = parseChunk(comment.body, limits);
    if (chunk.attemptId !== seal.attemptId) reject('attempt-mismatch');
    const file = files.get(chunk.file) || {parts:chunk.parts, payloads:new Map()};
    if (file.parts !== chunk.parts) reject('part-count-mismatch');
    if (file.payloads.has(chunk.part)) reject('duplicate-part');
    file.payloads.set(chunk.part, chunk.payload);
    files.set(chunk.file, file);
    chunks.push({commentId:id, file:chunk.file, part:chunk.part, parts:chunk.parts, bodyDigest:digest(comment.body)});
  }
  const output = {};
  let total = 0;
  for (const name of [...files.keys()].sort()) {
    const file = files.get(name);
    if (file.payloads.size !== file.parts) reject('missing-part');
    const text = Array.from({length:file.parts}, (_, i) => file.payloads.get(i + 1)).join('\n') + '\n';
    const bytes = Buffer.byteLength(text);
    if (bytes > limits.maxFileBytes) reject('file-too-large');
    if ((total += bytes) > limits.maxPackageBytes) reject('package-too-large');
    output[name] = text;
  }
  const names = Object.keys(output), articles = names.filter(n => n.startsWith('articles/'));
  if (articles.some(n => !n.startsWith(`articles/${seal.slug}-`))) reject('path-forbidden');
  if (!names.includes('edition.md') || !names.includes('editorial.json') || articles.length !== articleCount || names.length !== articleCount + 2) reject('package-file-set');
  return {files:output, chunks};
}

// Producer editorial data only; digests and trusted context are never accepted from it.
export function parseEditorial(text) {
  let value;
  try { value = JSON.parse(text); } catch { reject('editorial-invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'stories,version' || value.version !== 1 || !Array.isArray(value.stories)) reject('editorial-invalid');
  return value.stories;
}

function writeFiles(folder, files) {
  fs.mkdirSync(path.join(folder, 'articles'), {recursive:true});
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, ...name.split('/')), text, {flag:'wx'});
}

async function fetchComment(id, options) {
  const comment = await githubJSON(`/issues/comments/${id}`, {...options, allow404:true});
  if (!comment) reject('seal-unknown');
  return comment;
}
export async function listInbox(since, options) {
  const comments = [];
  for (let page = 1; page <= config.limits.maxInboxPages; page++) {
    const batch = await githubJSON(`/issues/${config.inboxIssue}/comments?since=${encodeURIComponent(since)}&per_page=100&page=${page}`, options);
    if (!Array.isArray(batch)) reject('inbox-unavailable');
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
  reject('inbox-scan-bound');
}
async function fenceMain(seal, head, env, now, options) {
  const main = await githubJSON('/git/ref/heads/main', options);
  if (main?.object?.sha !== seal.baseSha || head !== seal.baseSha || env.GITHUB_SHA !== seal.baseSha) reject('stale-base');
  if (jst(now()).slice(0, 10) !== seal.date) reject('stale-date');
}

export async function verifyCollector(seal, options) {
  const run = await githubJSON(`/actions/runs/${seal.collectorRunId}`, {...options, allow404:true});
  if (!run || String(run.id) !== seal.collectorRunId) reject('collector-missing');
  if (run.path !== config.collector.workflow || run.repository?.full_name !== config.repository || run.head_branch !== 'main' || !config.collector.events.includes(run.event)) reject('collector-workflow');
  if (run.head_sha !== seal.baseSha) reject('collector-sha');
  if (run.status !== 'completed' || run.conclusion !== 'success') reject('collector-not-successful');
  // GitHub reports the latest attempt; only that attempt is current under the shadow contract.
  if (run.run_attempt !== seal.collectorRunAttempt) reject('collector-attempt');
  if (jst(run.created_at).slice(0, 10) !== seal.date) reject('collector-date');
  const list = await githubJSON(`/actions/runs/${run.id}/artifacts?per_page=100`, options);
  if (!Array.isArray(list?.artifacts) || list.total_count > 100) reject('collector-artifact-missing');
  const name = `${config.collector.artifactPrefix}${run.id}-${run.run_attempt}`;
  const matches = list.artifacts.filter(a => a.name === name);
  if (matches.length !== 1) reject('collector-artifact-missing');
  const [artifact] = matches;
  if (artifact.expired || !Number.isSafeInteger(artifact.id) || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== seal.baseSha || !(artifact.size_in_bytes <= config.collector.maxArtifactBytes)) reject('collector-artifact-invalid');
  return {run, artifact};
}

// The report is read only from the artifact downloaded by trusted Actions credentials.
export function readCollectorReport(dir, seal) {
  let names;
  try { names = fs.readdirSync(dir); } catch { reject('collector-artifact-missing'); }
  if (names.join() !== 'report.json') reject('collector-artifact-invalid');
  const file = path.join(dir, 'report.json'), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > config.collector.maxReportBytes) reject('collector-artifact-invalid');
  let report;
  try { report = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { reject('collector-artifact-invalid'); }
  const c = report?.context;
  if (report?.version !== 1 || report.mode !== 'shadow' || report.publicationAuthorized !== false || !c || c.runId !== seal.collectorRunId || c.attempt !== seal.collectorRunAttempt || c.baseSha !== seal.baseSha || c.date !== seal.date || c.slug !== seal.slug) reject('collector-report-mismatch');
  if (report.status !== 'awaiting-editorial') reject('collector-not-awaiting-editorial');
  return report;
}

const gitHead = checkout => execFileSync('git', ['rev-parse', 'HEAD'], {cwd:checkout, encoding:'utf8'}).trim();

// Cheap checks before any artifact download; repeated in full by ingest().
export async function preflight({checkout = root, event, env = process.env, request, now = () => new Date()}) {
  const options = {request};
  const comment = checkEvent(event, env);
  const seal = parseSeal(comment.body);
  const sealComment = await fetchComment(comment.id, options);
  assertInboxComment(sealComment, 'seal');
  // Re-fetched seal must be the exact triggering event comment.
  if (sealComment.id !== comment.id || sealComment.body !== comment.body || sealComment.created_at !== comment.created_at || sealComment.updated_at !== comment.updated_at) reject('seal-edited');
  const head = gitHead(checkout);
  await fenceMain(seal, head, env, now, options);
  const {run, artifact} = await verifyCollector(seal, options);
  return {seal, sealComment, head, run, artifact};
}

export async function ingest({checkout = root, event, env = process.env, request, now = () => new Date(), collectorDir, outputDir, expectedArtifactId}) {
  const options = {request};
  const {seal, sealComment, head, run, artifact} = await preflight({checkout, event, env, request, now});
  if (expectedArtifactId !== undefined && artifact.id !== expectedArtifactId) reject('collector-artifact-invalid');
  const report = readCollectorReport(collectorDir, seal);

  const repository = loadRepository(checkout);
  if (repository.editions.some(e => e.slug === seal.slug)) reject('edition-exists');
  const branch = await githubJSON(`/git/ref/heads/daily/${seal.slug}`, {...options, allow404:true});
  const pulls = await githubJSON(`/pulls?state=open&head=${owner}:daily/${seal.slug}&per_page=100`, options);
  if (!Array.isArray(pulls)) reject('daily-conflict');
  if (editionState(repository, report.context, {branchExists:!!branch, pullRequests:pulls}) !== 'research') reject('daily-conflict');

  const inbox = await listInbox(run.created_at, options);
  const {files, chunks} = assemblePackage(seal, sealComment, inbox, {since:run.created_at});
  const stories = parseEditorial(files['editorial.json']);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jamio-ingress-'));
  try {
    const folder = path.join(work, 'drafts', seal.slug);
    writeFiles(folder, Object.fromEntries(Object.entries(files).filter(([name]) => name !== 'editorial.json')));
    // Autonomous v1 never carries price observations; data/prices.json is untouched.
    fs.writeFileSync(path.join(folder, 'prices.json'), '[]\n', {flag:'wx'});
    let bundle;
    try { bundle = readDraft(folder); } catch (error) { reject('draft-invalid', error.message); }
    // Every digest is computed here by trusted code from trusted bytes.
    const evidence = {version:1, context:report.context, reportDigest:digest(canonical(report)), packageDigest:digest(canonical(bundle)), stories};
    let current, result;
    try { current = await liveContext(checkout, seal.collectorRunId, {...options, now}); fence(report.context, current, now()); } catch (error) { reject('stale-context', error.message); }
    try { result = evaluateDraft(checkout, report, folder, evidence, current, now()); } catch (error) { reject('evidence-invalid', error.message); }

    // Mutable comments are not the trust object: re-fetch and compare everything at the end.
    const finalSeal = await fetchComment(sealComment.id, options);
    if (canonical(snapshot(finalSeal)) !== canonical(snapshot(sealComment))) reject('seal-altered');
    const finalInbox = await listInbox(run.created_at, options);
    const ids = new Set([sealComment.id, ...seal.chunks]);
    const pick = list => canonical(list.filter(c => ids.has(c.id)).map(snapshot).sort((a, b) => a.id - b.id));
    if (pick(finalInbox) !== pick(inbox)) reject('package-altered');
    const again = assemblePackage(seal, finalSeal, finalInbox, {since:run.created_at});
    if (canonical(again) !== canonical({files, chunks})) reject('package-altered');
    await fenceMain(seal, head, env, now, options);
    try { fence(report.context, await liveContext(checkout, seal.collectorRunId, {...options, now}), now()); } catch (error) { reject('stale-context', error.message); }

    return writeValidated(outputDir, {seal, sealComment, head, run, artifact, chunks, bundle, evidence, result, env, now});
  } finally {
    if (path.dirname(path.resolve(work)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe ingress cleanup');
    fs.rmSync(work, {recursive:true, force:true});
  }
}

function writeValidated(outputDir, {seal, sealComment, head, run, artifact, chunks, bundle, evidence, result, env, now}) {
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) reject('output-exists');
  const draft = path.join(outputDir, 'draft', seal.slug);
  // Normalized, trusted re-serialization of the validated bundle for the future writer.
  writeFiles(draft, Object.fromEntries([['edition.md', serialize(bundle.edition)], ...bundle.articles.map(a => [`articles/${a.slug}.md`, serialize(a)])]));
  fs.writeFileSync(path.join(draft, 'prices.json'), '[]\n', {flag:'wx'});
  if (digest(canonical(readDraft(draft))) !== evidence.packageDigest) reject('normalization-mismatch');
  const app = sealComment.performed_via_github_app?.slug;
  const collector = {runId:String(run.id), runAttempt:run.run_attempt, workflow:run.path, event:run.event, headSha:run.head_sha, createdAt:run.created_at, artifactId:artifact.id, artifactName:artifact.name, artifactDigest:typeof artifact.digest === 'string' ? artifact.digest : null, reportDigest:evidence.reportDigest};
  const receipt = {
    contract:'jamio-package-ingress-receipt', version:1, mode:'shadow', status:'validated',
    workflow:{runId:env.GITHUB_RUN_ID, runAttempt:Number(env.GITHUB_RUN_ATTEMPT), sha:head},
    inbox:{repository:config.repository, issue:config.inboxIssue},
    seal:{commentId:sealComment.id, createdAt:sealComment.created_at, bodyDigest:digest(sealComment.body)},
    producer:{actorId:sealComment.user.id, association:sealComment.author_association, app:typeof app === 'string' && /^[a-z0-9-]{1,100}$/.test(app) ? app : null},
    attemptId:seal.attemptId, date:seal.date, slug:seal.slug, variant:seal.variant, baseSha:seal.baseSha,
    collector:{runId:collector.runId, runAttempt:collector.runAttempt, artifactId:collector.artifactId, artifactName:collector.artifactName},
    chunks, reportDigest:evidence.reportDigest, packageDigest:evidence.packageDigest, evidenceDigest:digest(canonical(evidence)),
    editionUrl:result.editionUrl, editionDigest:result.digest, files:result.files,
    validatedAt:jst(now()), publicationAuthorized:false
  };
  for (const [name, value] of [['evidence.json', evidence], ['collector.json', collector], ['receipt.json', receipt]]) fs.writeFileSync(path.join(outputDir, name), JSON.stringify(value, null, 2) + '\n', {flag:'wx'});
  return receipt;
}

// One machine-readable line; producer-influenced text is reduced to inert characters.
export function logLine(value) {
  const clean = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/[^\w .:$[\]/,()+-]/g, '?').slice(0, 300) : v]));
  return `${LOG_MARKER} ${canonical(clean)}`;
}
function outputBase(env) {
  if (!env.RUNNER_TEMP) reject('runner-temp-required');
  const base = path.join(fs.realpathSync(env.RUNNER_TEMP), 'package-ingress');
  if (base === root || base.startsWith(path.resolve(root) + path.sep)) reject('output-in-repository');
  return base;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2), env = process.env;
  let event;
  try {
    if (args.length || !['plan', 'validate'].includes(command)) reject('usage', 'Usage: package-ingress.mjs plan | validate');
    event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    const base = outputBase(env);
    if (command === 'plan') {
      const {seal, run, artifact} = await preflight({event, env});
      fs.appendFileSync(env.GITHUB_OUTPUT, `collector-run=${run.id}\nartifact-id=${artifact.id}\n`);
      console.log(logLine({status:'planned', stage:'plan', sealCommentId:event.comment.id, attemptId:seal.attemptId, slug:seal.slug, collectorRunId:String(run.id), collectorArtifactId:artifact.id, publicationAuthorized:false}));
    } else {
      if (!/^[1-9][0-9]*$/.test(env.COLLECTOR_ARTIFACT_ID || '')) reject('collector-artifact-missing');
      const receipt = await ingest({event, env, collectorDir:path.join(base, 'collector'), outputDir:path.join(base, 'validated'), expectedArtifactId:Number(env.COLLECTOR_ARTIFACT_ID)});
      console.log(`${LOG_MARKER} ${canonical(receipt)}`);
      if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Package ingress shadow\n\nStatus: validated (NOT published). Slug: ${receipt.slug}. Publication authorized: false.\n\nPackage digest: \`${receipt.packageDigest}\`. Report digest: \`${receipt.reportDigest}\`.\n`);
    }
  } catch (error) {
    const code = error instanceof IngressError ? error.code : 'internal-error';
    const sealCommentId = Number.isSafeInteger(event?.comment?.id) ? event.comment.id : null;
    console.error(logLine({status:'rejected', stage:command || 'input', code, message:error.message, sealCommentId, publicationAuthorized:false}));
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Package ingress shadow\n\nRejected at ${command === 'plan' ? 'plan' : 'validate'}: \`${code}\`. Publication authorized: false. No validated-package artifact.\n`);
    process.exitCode = 1;
  }
}
