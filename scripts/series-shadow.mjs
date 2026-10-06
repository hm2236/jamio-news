import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {liveContext, fence, githubJSON, createContext} from './autonomous.mjs';
import {serialize, readDraft, validatePackage, loadRepository} from './production.mjs';
import {createSeriesInput, evaluateSeriesProposals, hash, emptyMetrics, failureMetrics, originalCreatedAt} from './series-proposal.mjs';
import {aggregateSeries} from './series-evaluation.mjs';
import {jst} from './source-research.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
// Outputs can ONLY be detached diagnostics under this ignored folder. Reject
// traversal, symlinks and junctions before any directory creation or file write.
export function saveDetached(checkout, file, value) {
  const base = path.resolve(checkout, 'series-shadow-output'), target = path.resolve(file);
  if (!target.startsWith(base + path.sep) || !target.endsWith('.json')) throw new Error('Output must be detached series-shadow-output/*.json');
  for (let item = path.dirname(target); ; item = path.dirname(item)) {
    if (fs.existsSync(item) && (fs.lstatSync(item).isSymbolicLink() || !fs.lstatSync(item).isDirectory())) throw new Error('Detached output ancestor is a link or non-directory');
    if (item === path.parse(item).root) break;
  }
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, JSON.stringify(value,null,2)+'\n', {flag:'wx'});
}
export function shadowSummary(result) {
  const metrics = result.metrics || emptyMetrics();
  return `## Series proposal shadow\n\nread-only / not registered / not published\n\nStatus: ${result.status}. Proposals: ${metrics.proposalCount}. Decisions: ${JSON.stringify(metrics.decisions)}. Evidence failure: ${metrics.evidenceFailure}. Human labels: ${metrics.humanLabel}.\n\nExisting editorial producer handoff is not connected by this workflow. Waiting or ineligible runs are unevaluated; zero proposals does not establish precision or seven-day completion.\n`;
}
export async function historicalReplay(checkout, record, run) {
  const base = run.head_sha;
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Invalid historical SHA');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jamio-series-replay-'));
  const git = args => execFileSync('git', args, {cwd:checkout, encoding:'utf8'});
  try {
    validatePackage(record.bundle); // Validate all slugs before scratch writes.
    // Only read Git objects. Never checkout/create a branch or execute old code.
    const files = git(['ls-tree','-r','--name-only',base,'--','content/','data/','config/research-sources.json','site.config.json']).trim().split('\n').filter(Boolean);
    for (const file of files) {
      if (!/^(content\/(articles|editions)\/[^/]+\.md|data\/(prices\.json|series\/[^/]+\.json)|config\/research-sources\.json|site\.config\.json)$/.test(file)) continue;
      const mode = git(['ls-tree',base,'--',file]).split(/\s/)[0];
      if (mode !== '100644') throw new Error('Historical input is not a regular file');
      const target = path.join(folder,file); fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,git(['show',`${base}:${file}`]));
    }
    const draft = path.join(folder,'drafts',record.bundle.edition.slug);
    fs.mkdirSync(path.join(draft,'articles'),{recursive:true});
    fs.writeFileSync(path.join(draft,'edition.md'),serialize(record.bundle.edition));
    fs.writeFileSync(path.join(draft,'prices.json'),JSON.stringify(record.bundle.priceObservations));
    for (const article of record.bundle.articles) fs.writeFileSync(path.join(draft,'articles',article.slug+'.md'),serialize(article));
    const repository = loadRepository(folder);
    const prior = repository.editions.filter(e => e.kind === 'daily' && Date.parse(e.published) < Date.parse(run.created_at)).sort((a,b) => Date.parse(b.published)-Date.parse(a.published))[0];
    const context = createContext({runId:run.id,attempt:run.run_attempt,createdAt:run.created_at,baseSha:base,windowStart:prior?.published || jst(Date.parse(run.created_at)-86400000)});
    return evaluateSeriesProposals(folder,{...record,folder:draft,expectedProposalDigest:record.evaluation.proposalDigest},context,new Date(record.evaluation.evaluatedAt));
  } finally {
    if (path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe replay cleanup');
    fs.rmSync(folder,{recursive:true,force:true});
  }
}
export async function windowRuns(start, {get = githubJSON} = {}) {
  const runs = [];
  for (let page = 1; page <= 100; page++) {
    const response = await get(`/actions/workflows/autonomous-shadow.yml/runs?per_page=100&page=${page}`);
    if (!Array.isArray(response.workflow_runs)) throw new Error('Authoritative workflow runs unavailable');
    runs.push(...response.workflow_runs);
    if (response.workflow_runs.length < 100 || response.workflow_runs.every(r => Date.parse(r.created_at) < Date.parse(start+'T00:00:00+09:00'))) return runs;
  }
  throw new Error('Run listing truncated; cannot prove continuity');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command,...args] = process.argv.slice(2); let current, input, submission;
  try {
    let result, output;
    if (command === 'prepare' && args.length === 2) {
      if (process.env.GITHUB_REPOSITORY !== 'hm2236/jamio-news' || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Prepare requires trusted main workflow');
      const report = read(args[0]); current = await liveContext(root,process.env.GITHUB_RUN_ID);
      if (String(current.attempt) !== process.env.GITHUB_RUN_ATTEMPT || current.baseSha !== process.env.GITHUB_SHA) throw new Error('Workflow attempt or SHA differs');
      input = createSeriesInput(root,report,current);
      fence(current,await liveContext(root,current.runId));
      saveDetached(root,path.join(args[1],'input.json'),input);
      result = {version:1,status:input.status,mode:'read-only',context:current,runCreatedAt:input.runCreatedAt,headSha:input.headSha,inputDigest:hash(input),metrics:{...emptyMetrics(),sourceCoverage:report.research?.coverage || {},sourceFailures:report.research?.failures.length || 0},publicationAuthorized:false,registrationAuthorized:false};
      output = path.join(args[1],'evaluation.json');
    } else if (command === 'evaluate' && args.length === 7) {
      // Independently pinned digest is a separate argument, never read from LLM JSON.
      const [inputFile,reportFile,draft,evidenceFile,submissionFile,expectedProposalDigest,out] = args;
      input = read(inputFile); submission = read(submissionFile);
      const report = read(reportFile), evidence = read(evidenceFile);
      current = await liveContext(root,input.context.runId); fence(input.context,current);
      const evaluation = evaluateSeriesProposals(root,{input,report,folder:draft,evidence,submission,expectedProposalDigest},current);
      fence(current,await liveContext(root,current.runId));
      result = {input,report,bundle:readDraft(draft),evidence,submission,evaluation}; output = out;
    } else if (command === 'aggregate' && args.length === 4) {
      const [recordsFile,start,end,out] = args;
      // Validate date bounds before any endpoint or Git operation.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('Invalid date window');
      const runs = await windowRuns(start);
      result = await aggregateSeries(read(recordsFile),runs,{start,end,revalidate:(record,run) => historicalReplay(root,record,run)}); output = out;
      const refreshed = await windowRuns(start);
      if (hash(runs) !== hash(refreshed)) throw new Error('Workflow runs or latest attempts changed during aggregation');
    } else throw new Error('Usage: series-shadow.mjs prepare <report> <series-shadow-output/run-attempt> | evaluate <input> <report> <draft> <evidence> <submission> <pinned-sha256> <series-shadow-output/record.json> | aggregate <records.json> <start-JST-date> <end-JST-date> <series-shadow-output/aggregate.json>');
    saveDetached(root,output,result);
    const summary = result.evaluation || result;
    console.log(JSON.stringify({status:summary.status || 'aggregated',mode:'read-only',metrics:summary.metrics || summary.totals,publicationAuthorized:false,registrationAuthorized:false}));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,shadowSummary(summary));
  } catch (error) {
    const result = {version:1,status:'evidence-failure',mode:'read-only',...(current ? {context:current,runCreatedAt:originalCreatedAt(current),headSha:current.baseSha} : {}),
      metrics:failureMetrics(submission),publicationAuthorized:false,registrationAuthorized:false,error:error.message};
    // Failure output is fixed and detached, independent of untrusted input paths.
    const id = /^\d+$/.test(process.env.GITHUB_RUN_ID || '') ? process.env.GITHUB_RUN_ID : 'local';
    const attempt = /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || '') ? process.env.GITHUB_RUN_ATTEMPT : 'local';
    try { saveDetached(root,path.join(root,'series-shadow-output',`${id}-${attempt}`,'failure.json'),result); } catch { /* Preserve immutable prior diagnostics. */ }
    console.error(JSON.stringify({status:result.status,publicationAuthorized:false,registrationAuthorized:false}));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,shadowSummary(result));
    process.exitCode = 1;
  }
}
