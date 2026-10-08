import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {assertSchema, isJST} from './contract.mjs';
import {canonical, loadRepository, editionDigest, readDraft, planDraft} from './production.mjs';
import {confirmPublication} from './confirm-publication.mjs';
import {registry, approvedSource, collectSources, digest, jst, normalizeText} from './source-research.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const repoName = 'hm2236/jamio-news';
export const evidenceSchema = JSON.parse(fs.readFileSync(new URL('../contracts/autonomous.schema.json',import.meta.url),'utf8'));
// Reuse the existing assertion evaluator without changing the publishing contract.
function expanded(schema) {
  if (Array.isArray(schema)) return schema.map(expanded);
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) return expanded(evidenceSchema.$defs[schema.$ref.split('/').at(-1)]);
  return Object.fromEntries(Object.entries(schema).filter(([k]) => k !== '$defs').map(([k,v]) => [k,expanded(v)]));
}
export function createContext({runId,attempt,createdAt,baseSha,windowStart}) {
  const startedAt = jst(createdAt), date = startedAt.slice(0,10);
  const context = {runId:String(runId),attempt,startedAt,date,slug:date+'-morning',baseSha,windowStart};
  assertSchema(context,expanded(evidenceSchema.$defs.context));
  if (Date.parse(windowStart) > Date.parse(startedAt)) throw new Error('Research window follows run start');
  return context;
}
export function fence(context, current, now = new Date()) {
  assertSchema(context,expanded(evidenceSchema.$defs.context));
  if (canonical(context) !== canonical(current) || context.date !== context.startedAt.slice(0,10) || context.slug !== context.date+'-morning' || jst(now).slice(0,10) !== context.date || Date.parse(context.startedAt) > +new Date(now) || +new Date(now)-Date.parse(context.startedAt)>2*3600000) throw new Error('Stale run date, main SHA, run identity or attempt');
}
export function editionState(repository, context, {branchExists = false, pullRequests = []} = {}) {
  if (repository.editions.some(e => e.slug === context.slug)) return 'confirm-existing';
  if (branchExists || pullRequests.length || repository.articles.some(a => a.slug.startsWith(context.slug+'-'))) return 'blocked-conflict';
  return 'research';
}
export function repositoryDigests(repository) {
  return Object.fromEntries(repository.editions.map(e => [e.slug,editionDigest(e,repository.articles,repository.prices)]));
}
export function evaluateDraft(checkout, report, folder, evidence, current, now = new Date()) {
  assertSchema(evidence,expanded(evidenceSchema));
  fence(report.context,current,now);
  if (!['awaiting-editorial','research-complete'].includes(report.status) || canonical(evidence.context) !== canonical(report.context) || evidence.reportDigest !== digest(canonical(report))) throw new Error('Evidence belongs to another research report');
  // Validate collisions, append-only history, every existing digest and the full existing contract.
  const bundle = readDraft(folder), plan = planDraft(checkout,folder);
  if (bundle.date !== report.context.date || bundle.edition.slug !== report.context.slug || evidence.packageDigest !== digest(canonical(bundle))) throw new Error('Evidence package date/slug/digest mismatch');
  if (Date.parse(bundle.edition.published) < Date.parse(current.startedAt) || Date.parse(bundle.edition.published) > +new Date(now)) throw new Error('Edition cannot predate run or have a future publication time');
  const existing = loadRepository(checkout);
  if (canonical(report.existingDigests) !== canonical(repositoryDigests(existing)) || editionState(existing,current) !== 'research') throw new Error('Repository changed or edition already exists');
  if (bundle.priceObservations.length || bundle.edition.production.x.status !== 'unavailable') throw new Error('Shadow v1 has no authenticated X or transactional price observer');
  if (evidence.stories.length !== bundle.articles.length || new Set(evidence.stories.map(s=>s.slug)).size !== evidence.stories.length) throw new Error('Every article needs one unique evidence story');
  const snapshots = report.research.snapshots;
  if (new Set(snapshots.map(s=>s.url)).size !== snapshots.length) throw new Error('Duplicate source snapshots');
  for (const snapshot of snapshots) {
    const source = approvedSource(snapshot.url), final = approvedSource(snapshot.finalUrl);
    if (source.id !== final.id || source.id !== snapshot.sourceId || source.type !== snapshot.type || source.category !== snapshot.category || snapshot.digest !== digest(snapshot.text) || !isJST(snapshot.checked) || snapshot.checked.slice(0,10) !== current.date || Date.parse(snapshot.checked) < Date.parse(current.startedAt) || Date.parse(snapshot.checked) > +new Date(now)) throw new Error('Invalid source identity, digest or checked time');
  }
  const eventUrls = new Set(), bodies = new Set();
  for (const story of evidence.stories) {
    const article = bundle.articles.find(a=>a.slug===story.slug);
    if (!article) throw new Error('Evidence references absent article');
    if (article.body.length < 600 || bodies.has(normalizeText(article.body))) throw new Error('Thin or duplicate article body');
    bodies.add(normalizeText(article.body));
    if (eventUrls.has(story.eventUrl) || registry.sources.some(s=>s.url===story.eventUrl) || existing.articles.some(a=>a.sources?.some(s=>s.url===story.eventUrl))) throw new Error('Duplicate, recycled or index-page event');
    eventUrls.add(story.eventUrl);
    const event = snapshots.find(s=>s.url===story.eventUrl);
    if (!event || !event.text.includes(story.eventDateText) || !article.sources.some(s=>s.url===story.eventUrl) || Date.parse(story.eventAt) <= Date.parse(current.windowStart) || Date.parse(story.eventAt) > Date.parse(event.checked)) throw new Error('Event lacks dated fresh primary evidence');
    for (const source of article.sources) {
      const snapshot = snapshots.find(s=>s.url===source.url);
      if (!snapshot || source.checked !== snapshot.checked || source.type !== snapshot.type || !story.claims.some(c=>c.citations.some(s=>s.url===source.url))) throw new Error('Article source must be fetched, accurately typed and cited');
    }
    for (const field of ['importance','impact','limitations']) if (!article.body.includes(story[field])) throw new Error('Missing importance, impact or limitations in full article');
    for (const heading of ['## 確認した事実','## じゃみおへの影響','## 考察・未確定点','## 出典と検証']) if (!article.body.includes(heading)) throw new Error('Missing deep-dive section');
    if (new Set(story.claims.map(c=>c.text)).size !== story.claims.length || !story.claims.some(c=>c.kind==='fact')) throw new Error('Distinct factual claims required');
    for (const claim of story.claims) {
      const label = {fact:'確認済み事実',inference:'推論',rumor:'未確認情報'}[claim.kind];
      if (!article.body.includes(`[${label}] ${claim.text}`)) throw new Error('Claim missing explicit fact/inference/rumor label');
      if (claim.kind === 'rumor' && article.status !== 'unconfirmed') throw new Error('Rumor cannot be included in a verified article');
      for (const citation of claim.citations) {
        const snapshot = snapshots.find(s=>s.url===citation.url);
        if (!snapshot || !article.sources.some(s=>s.url===citation.url) || !snapshot.text.includes(citation.excerpt) || citation.excerpt.length > 600) throw new Error('Citation excerpt missing from fetched source or article sources');
      }
    }
  }
  return {status:'shadow-ready',...current,editionUrl:plan.editionUrl,digest:plan.digest,packageDigest:evidence.packageDigest,reportDigest:evidence.reportDigest,files:plan.writes.map(w=>w.file),publicationAuthorized:false};
}

export async function githubJSON(endpoint, {request = fetch, allow404 = false} = {}) {
  // Only fixed repository-relative GETs; token never goes to source publishers.
  if (!endpoint.startsWith('/') || endpoint.includes('..')) throw new Error('Invalid repository endpoint');
  const headers = {Accept:'application/vnd.github+json'};
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await request(`https://api.github.com/repos/${repoName}${endpoint}`,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub read HTTP ${response.status}`);
  return response.json();
}
export async function liveContext(checkout, runId, options = {}) {
  if (!/^[1-9][0-9]*$/.test(String(runId))) throw new Error('Invalid run ID');
  const run = await githubJSON(`/actions/runs/${runId}`,options);
  const main = await githubJSON('/git/ref/heads/main',options);
  const head = execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim();
  if (run.path !== '.github/workflows/autonomous-shadow.yml' || !['schedule','workflow_dispatch'].includes(run.event) || run.head_branch !== 'main' || run.head_sha !== head || head !== main.object.sha) throw new Error('Run is not the current trusted main shadow workflow');
  const repository = loadRepository(checkout);
  const prior = repository.editions.filter(e=>e.kind==='daily' && Date.parse(e.published)<Date.parse(run.created_at)).sort((a,b)=>Date.parse(b.published)-Date.parse(a.published))[0];
  const context = createContext({runId:run.id,attempt:run.run_attempt,createdAt:run.created_at,baseSha:head,windowStart:prior?.published || jst(Date.parse(run.created_at)-86400000)});
  fence(context,context,options.now?.()); // Injectable clock for detached ingress tests; defaults to now.
  return context;
}
export async function shadow(checkout, context, {get = githubJSON, collect = collectSources, confirm = confirmPublication, now = () => new Date()} = {}) {
  fence(context,context,now());
  const repository = loadRepository(checkout);
  const branch = await get(`/git/ref/heads/daily/${context.slug}`,{allow404:true});
  const prs = await get(`/pulls?state=open&head=hm2236:daily/${context.slug}&per_page=100`);
  const state = editionState(repository,context,{branchExists:!!branch,pullRequests:prs});
  const report = {version:1,mode:'shadow',context,existingDigests:repositoryDigests(repository),status:state,publicationAuthorized:false};
  if (state === 'confirm-existing') {
    // No regeneration or daily writes, even if Pages is unavailable.
    report.publication = await confirm(checkout,context.slug,context.baseSha);
    report.status = 'already-published';
  } else if (state === 'research') {
    report.research = await collect();
    report.status = report.research.snapshots.length ? 'awaiting-editorial' : 'blocked-research';
  }
  const main = await get('/git/ref/heads/main');
  if (main.object.sha !== context.baseSha) throw new Error('Stale main after research/confirmation');
  fence(context,context,now());
  return report;
}
function save(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'}); // Immutable output; never overwrite another attempt.
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command,...args] = process.argv.slice(2);
  try {
    let result;
    if (command === 'shadow' && args.length === 1) {
      if (process.env.GITHUB_REPOSITORY !== repoName || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Shadow requires this repository main');
      const context = await liveContext(root,process.env.GITHUB_RUN_ID);
      if (Number(process.env.GITHUB_RUN_ATTEMPT) !== context.attempt || process.env.GITHUB_SHA !== context.baseSha) throw new Error('Stale workflow attempt');
      result = await shadow(root,context);
      save(path.join(args[0],'report.json'),result);
    } else if (command === 'enrich' && args.length === 3) {
      const report = JSON.parse(fs.readFileSync(args[0],'utf8'));
      const current = await liveContext(root,report.context.runId); fence(report.context,current);
      if (report.status !== 'awaiting-editorial') throw new Error('Only research reports can be enriched');
      const research = await collectSources(JSON.parse(fs.readFileSync(args[1],'utf8')));
      const byURL = new Map([...report.research.snapshots,...research.snapshots].map(s=>[s.url,s]));
      result = {...report,research:{...research,snapshots:[...byURL.values()],failures:[...report.research.failures,...research.failures]}};
      fence(report.context,await liveContext(root,current.runId));
      save(args[2],result);
    } else if (command === 'evaluate' && args.length === 3) {
      const report = JSON.parse(fs.readFileSync(args[0],'utf8'));
      result = evaluateDraft(root,report,args[1],JSON.parse(fs.readFileSync(args[2],'utf8')),await liveContext(root,report.context.runId));
      fence(report.context,await liveContext(root,report.context.runId));
    } else throw new Error('Usage: autonomous.mjs shadow <output-folder> | enrich <report.json> <urls.json> <new-report.json> | evaluate <report.json> <draft-folder> <evidence.json>');
    // Keep fetched source text in the artifact, not Actions logs or summaries.
    const {research,...summary} = result;
    console.log(JSON.stringify({...summary,...(research ? {research:{count:research.snapshots.length,failures:research.failures,coverage:research.coverage,x:research.x}} : {})}));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Autonomous shadow\n\nStatus: ${result.status}. Publication authorized: false.\n\n${result.status === 'awaiting-editorial' ? 'Source collection finished. Existing ChatGPT producer handoff is not connected; no edition was generated or published.' : 'See the immutable report artifact for the exact state.'}\n`);
    if (result.status.startsWith('blocked')) process.exitCode = 1;
  } catch (error) {
    const result = {status:'failed',stage:command || 'input',publicationAuthorized:false,error:error.message};
    console.error(JSON.stringify(result));
    if (command === 'shadow' && args.length === 1) { try {save(path.join(args[0],'failure.json'),result);} catch { /* Retain prior immutable report. */ } }
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Autonomous shadow\n\nFailed; publication authorized: false. See sanitized failure artifact.\n');
    process.exitCode = 1;
  }
}
