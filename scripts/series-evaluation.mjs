import {canonical} from './production.mjs';
import {isDate} from './contract.mjs';
import {jst} from './source-research.mjs';
import {hash, humanMetrics, decisions} from './series-proposal.mjs';

const fail = message => { throw new Error(`Series evaluation: ${message}`); };
// Authoritative runs MUST be fetched from GitHub, including every schedule and
// manual run in the selected window, with latest attempts (no cherry picking).
// revalidate replays the original inputs against that exact historical Git base.
export async function aggregateSeries(records, runs, {start, end, revalidate}) {
  if (!isDate(start) || !isDate(end) || end < start || typeof revalidate !== 'function' || !Array.isArray(records) || !Array.isArray(runs)) fail('invalid window or missing trusted replay');
  const days = [];
  for (let day = start; day <= end; day = new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10)) {
    days.push(day); if (days.length > 90) fail('window exceeds 90 days');
  }
  const selected = runs.filter(run => run.path === '.github/workflows/autonomous-shadow.yml' && run.head_branch === 'main' && ['schedule','workflow_dispatch'].includes(run.event) && jst(run.created_at).slice(0,10) >= start && jst(run.created_at).slice(0,10) <= end);
  if (new Set(selected.map(r => String(r.id))).size !== selected.length) fail('duplicate authoritative run');
  const byRun = new Map();
  for (const record of records) {
    const ctx = record.evaluation?.binding?.context || record.context;
    if (!ctx || byRun.has(ctx.runId)) fail('missing or duplicate run record');
    const run = selected.find(r => String(r.id) === ctx.runId);
    if (!run || ctx.attempt !== run.run_attempt || ctx.baseSha !== run.head_sha || ctx.date !== jst(run.created_at).slice(0,10) || ctx.startedAt !== jst(run.created_at)) fail('stale attempt, base, original date or unlisted run');
    byRun.set(ctx.runId, record);
  }
  const totals = {proposalCount: 0, decisions: Object.fromEntries(decisions.map(d => [d,0])), falseMerge: 0, missedContinuation: 0, duplicateProposal: 0, ambiguous: 0, evidenceFailure: 0, evaluatedRuns: 0, unevaluatedRuns: 0, proposed: 0, eligible: 0};
  const results = [];
  for (const run of selected) {
    const record = byRun.get(String(run.id));
    if (!record || record.evaluation?.status !== 'proposal-valid' || run.status !== 'completed' || run.conclusion !== 'success') {
      totals.unevaluatedRuns++; totals.evidenceFailure += record?.metrics?.evidenceFailure || 0;
      results.push({runId: String(run.id), attempt: run.run_attempt, baseSha: run.head_sha, date: jst(run.created_at).slice(0,10), status: 'unevaluated', reason: record?.status || 'missing or unsuccessful run'});
      continue;
    }
    const evaluation = await revalidate(record, run);
    if (canonical(evaluation) !== canonical(record.evaluation) || evaluation.binding.headSha !== run.head_sha || evaluation.binding.runCreatedAt !== run.created_at || evaluation.publicationAuthorized !== false || evaluation.registrationAuthorized !== false) fail('historical replay differs from evaluation');
    const metrics = humanMetrics(evaluation, record.submission, record.labels);
    totals.proposalCount += metrics.proposalCount;
    for (const decision of decisions) totals.decisions[decision] += metrics.decisions[decision];
    for (const key of ['falseMerge','missedContinuation','duplicateProposal','ambiguous','evidenceFailure']) totals[key] += metrics[key] || 0;
    totals.proposed += metrics.coverage.proposed; totals.eligible += metrics.coverage.eligible;
    const complete = metrics.humanLabel === 'evaluated' && metrics.coverage.ratio === 1;
    totals[complete ? 'evaluatedRuns' : 'unevaluatedRuns']++;
    results.push({runId: String(run.id), attempt: run.run_attempt, baseSha: run.head_sha, date: evaluation.binding.context.date,
      status: complete ? 'evaluated' : 'unevaluated', evaluationDigest: hash(evaluation), metrics});
  }
  const continuity = days.every(date => results.some(r => r.date === date) && results.filter(r => r.date === date).every(r => r.status === 'evaluated'));
  const sevenDayWindowComplete = days.length >= 7 && continuity && selected.length > 0 && totals.unevaluatedRuns === 0;
  return {version: 1, mode: 'read-only', start, end, days: days.length, expectedRuns: selected.length, continuity, sevenDayWindowComplete,
    qualityGateObserved: sevenDayWindowComplete && totals.falseMerge === 0 && totals.missedContinuation === 0 && totals.duplicateProposal === 0 && totals.ambiguous === 0 && totals.evidenceFailure === 0,
    totals: {...totals, coverage: totals.eligible ? totals.proposed / totals.eligible : null}, runs: results,
    publicationAuthorized: false, registrationAuthorized: false, stage3Authorized: false};
}
