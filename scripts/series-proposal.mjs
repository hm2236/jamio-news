import fs from 'node:fs';
import path from 'node:path';
import {assertSchema, isJST} from './contract.mjs';
import {canonical, loadRepository, readDraft} from './production.mjs';
import {fence, evaluateDraft, repositoryDigests} from './autonomous.mjs';
import {registry as sourceRegistry, approvedSource, digest, jst, normalizeText} from './source-research.mjs';
import {readSeries, validateSeries, registryDigest} from './series.mjs';

export const proposalSchema = JSON.parse(fs.readFileSync(new URL('../contracts/series-proposal.schema.json', import.meta.url), 'utf8'));
const labelSchema = JSON.parse(fs.readFileSync(new URL('../contracts/series-labels.schema.json', import.meta.url), 'utf8'));
export const decisions = ['existing-update', 'new-series', 'related-only', 'none', 'needs-review'];
export const hash = value => digest(canonical(value));
const fail = message => { throw new Error(`Series shadow: ${message}`); };
function expanded(schema) {
  if (Array.isArray(schema)) return schema.map(expanded);
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) return expanded(proposalSchema.$defs[schema.$ref.split('/').at(-1)]);
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$defs').map(([key, value]) => [key, expanded(value)]));
}
export const originalCreatedAt = context => new Date(context.startedAt).toISOString().replace('.000Z', 'Z');
export const publishedCorpus = repository => repository.articles.filter(a => a.kind === 'news' && repository.editions.some(e => e.kind === 'daily' && e.articles.includes(a.slug))).sort((a,b) => a.slug.localeCompare(b.slug)).map(article => ({article: article.slug, articleDigest: hash(article), body: article.body, sources: article.sources}));

// All inputs come from the frozen main checkout and the detached morning report.
// This is an editorial input, not a proposed public registry or a virtual sidecar.
export function createSeriesInput(checkout, report, current, now = new Date()) {
  fence(report.context, current, now);
  if (report.version !== 1 || report.mode !== 'shadow' || report.publicationAuthorized !== false) fail('not a detached morning report');
  const repository = loadRepository(checkout), registry = validateSeries(readSeries(checkout), repository);
  if (canonical(report.existingDigests) !== canonical(repositoryDigests(repository))) fail('published history changed');
  const sources = JSON.parse(fs.readFileSync(path.join(checkout, 'config/research-sources.json'), 'utf8'));
  if (canonical(sources) !== canonical(sourceRegistry)) fail('source registry differs from trusted evaluator');
  const snapshots = report.research?.snapshots || [];
  if (new Set(snapshots.map(s => s.url)).size !== snapshots.length) fail('duplicate source snapshots');
  for (const snapshot of snapshots) {
    const source = approvedSource(snapshot.url), final = approvedSource(snapshot.finalUrl);
    if (source.id !== final.id || snapshot.sourceId !== source.id || snapshot.type !== source.type || snapshot.category !== source.category || snapshot.digest !== digest(snapshot.text) || !isJST(snapshot.checked) || snapshot.checked.slice(0,10) !== current.date || Date.parse(snapshot.checked) < Date.parse(current.startedAt) || Date.parse(snapshot.checked) > +new Date(now)) fail('source identity, digest or acquisition time mismatch');
  }
  const corpus = publishedCorpus(repository);
  return {version: 1, mode: 'read-only', context: current, runCreatedAt: originalCreatedAt(current), headSha: current.baseSha,
    registryDigest: registryDigest(registry), sourceRegistryDigest: hash(sources), snapshotsDigest: hash(snapshots), corpusDigest: hash(corpus), reportDigest: hash(report),
    registry, corpus, snapshots, status: ['awaiting-editorial','research-complete'].includes(report.status) ? 'awaiting-editorial' : 'ineligible-morning',
    publicationAuthorized: false, registrationAuthorized: false};
}
export function proposalBinding(input, bundle, evidence) {
  const {context, runCreatedAt, headSha, registryDigest, sourceRegistryDigest, snapshotsDigest, corpusDigest, reportDigest} = input;
  return {context, runCreatedAt, headSha, registryDigest, sourceRegistryDigest, snapshotsDigest, corpusDigest, reportDigest, inputDigest: hash(input), packageDigest: hash(bundle), evidenceDigest: hash(evidence)};
}
export function decisionCounts(proposals = []) {
  return Object.fromEntries(decisions.map(decision => [decision, proposals.filter(p => p.decision === decision).length]));
}
export function emptyMetrics() {
  return {proposalCount: 0, decisions: decisionCounts(), humanLabel: 'unevaluated', falseMerge: null, missedContinuation: null, duplicateProposal: 0, ambiguous: 0, evidenceFailure: 0, coverage: {proposed: 0, eligible: 0, ratio: null}, sourceCoverage: {}, sourceFailures: 0};
}
export function failureMetrics(submission) {
  const proposals = Array.isArray(submission?.proposals) ? submission.proposals.slice(0,10).filter(p => p && typeof p === 'object') : [];
  const seen = new Set(); let duplicates = 0;
  for (const proposal of proposals) {
    const keys = [proposal.id,proposal.article,proposal.event?.key].map((value,index) => `${index}:${value}`);
    duplicates += Number(keys.some(key => seen.has(key))); keys.forEach(key => seen.add(key));
  }
  return {...emptyMetrics(), proposalCount:proposals.length, decisions:decisionCounts(proposals), duplicateProposal:duplicates, evidenceFailure:1};
}
const identityFields = identity => [
  ['canonicalTopic.key', identity.canonicalTopic.key], ['canonicalTopic.scope', identity.canonicalTopic.scope],
  ...identity.entities.map(e => [`entity:${e.type}:${e.key}`, e.key]),
  ...['region','productVersion','incidentId','campaignId'].filter(key => identity[key]).map(key => [key, identity[key]])
];
function checkIdentity(identity) {
  if (new Set(identity.entities.map(e => canonical([e.type,e.key]))).size !== identity.entities.length) fail('duplicate identity entities');
  if (!identity.region.trim() || !identity.entities.some(e => e.type !== 'organization')) fail('region and a strong tracking identity are required; company alone is insufficient');
  if (identity.entities.some(e => e.type === 'product') && !identity.productVersion.trim()) fail('product version unknown');
  for (const [type, field] of [['incident','incidentId'], ['campaign','campaignId']]) if (identity.entities.some(e => e.type === type) && (!identity[field] || !identity.entities.some(e => e.type === type && e.key === identity[field]))) fail(`${type} identity mismatch`);
}
function validateOne(proposal, input, bundle, evidence) {
  const story = evidence.stories.find(s => s.slug === proposal.article), article = bundle.articles.find(a => a.slug === proposal.article);
  if (!story || !article || proposal.event.url !== story.eventUrl || proposal.event.at !== story.eventAt) fail('proposal event not bound to morning article/evidence');
  if (!Number.isFinite(proposal.confidence) || proposal.confidence > 1) fail('invalid confidence');
  const citation = value => {
    const source = input.snapshots.find(s => s.url === value.url);
    if (!source || value.excerpt.length > 600 || !source.text.includes(value.excerpt) || value.sourceDigest !== source.digest || value.checked !== source.checked || value.sourceRegistryDigest !== input.sourceRegistryDigest || !article.sources.some(s => s.url === value.url)) fail('citation is not literal fetched article evidence');
  };
  proposal.citations.forEach(citation);
  if (!proposal.citations.some(c => c.url === story.eventUrl)) fail('event needs its own primary citation');
  for (const item of proposal.identityEvidence) { citation(item.citation); if (!item.citation.excerpt.includes(item.value)) fail('identity value absent from literal evidence'); }
  // Compare every trusted registry candidate, including inactive and competing ones.
  if (new Set(proposal.comparedCandidates.map(c => c.candidateSeriesId)).size !== proposal.comparedCandidates.length || canonical(proposal.comparedCandidates.map(c => c.candidateSeriesId).sort()) !== canonical(input.registry.map(s => s.id).sort())) fail('missing, duplicate or nonexistent compared candidate');
  const matches = proposal.comparedCandidates.filter(c => c.disposition === 'match'), ambiguous = proposal.comparedCandidates.some(c => c.disposition === 'ambiguous');
  if ((matches.length > 1 || ambiguous) && proposal.decision !== 'needs-review') fail('competing series require review');
  if (!['existing-update','needs-review'].includes(proposal.decision) && matches.length) fail('match cannot be discarded without review');
  const claims = new Set();
  for (const claim of proposal.comparedClaims) {
    const previous = input.corpus.find(a => a.article === claim.article);
    if (claims.has(claim.article) || !previous || claim.articleDigest !== previous.articleDigest || claim.excerpt.length > 600 || !previous.body.includes(claim.excerpt)) fail('previous claim absent, duplicated or changed');
    claims.add(claim.article);
  }
  // Exhaustive published comparison makes negative decisions and misses auditable.
  if (canonical([...claims].sort()) !== canonical(input.corpus.map(a => a.article).sort())) fail('published claim comparison coverage incomplete');
  const positive = ['existing-update','new-series'].includes(proposal.decision);
  if (positive) {
    checkIdentity(proposal.identity);
    const required = identityFields(proposal.identity);
    if (proposal.identityEvidence.length !== required.length || new Set(proposal.identityEvidence.map(e => e.field)).size !== required.length || required.some(([field,value]) => !proposal.identityEvidence.some(e => e.field === field && e.value === value))) fail('complete literal identity evidence required');
    if (!['new-event','material-update'].includes(proposal.novelty.kind) || proposal.novelty.delta.trim().length < 20 || !proposal.novelty.continuityReason.trim()) fail('novelty, delta and continuity evidence required');
    if (!proposal.citations.some(c => c.excerpt.includes(proposal.novelty.delta))) fail('delta absent from new primary citation');
    if (!story.claims.some(c => c.kind === 'fact' && c.citations.some(s => s.url === story.eventUrl && s.excerpt.includes(proposal.novelty.delta)))) fail('delta is not bound to an evidenced morning fact');
    if (proposal.comparedClaims.some(c => c.disposition === 'ambiguous')) fail('ambiguous published claim requires review');
  }
  if (proposal.decision === 'existing-update') {
    const series = input.registry.find(s => s.id === proposal.candidateSeriesId);
    if (!series || matches.length !== 1 || matches[0].candidateSeriesId !== series.id) fail('existing candidate absent or not uniquely matched');
    if (series.status !== 'active' || !series.members.length) fail('inactive or empty series requires review');
    if (canonical(proposal.identity.canonicalTopic) !== canonical(series.canonicalTopic) || canonical(proposal.identity.entities) !== canonical(series.entities)) fail('trusted topic/scope/entities differ');
    if (!proposal.previousIdentity || canonical(proposal.previousIdentity) !== canonical(proposal.identity)) fail('different region, version, incident, campaign or topic');
    const previousArticle = series.members.at(-1).article;
    const claim = proposal.comparedClaims.find(c => c.article === previousArticle && c.disposition === 'same-target');
    if (!claim || proposal.novelty.previousArticle !== previousArticle || identityFields(proposal.previousIdentity).some(([,value]) => !claim.excerpt.includes(value))) fail('latest series published claim lacks identity/delta comparison');
    if (normalizeText(claim.excerpt).includes(normalizeText(proposal.novelty.delta)) || series.members.some(m => m.eventKey === proposal.event.key)) fail('recycled event or no new delta');
    const ordinal = proposal.event.milestone?.ordinal, previousOrdinal = series.members.filter(m => m.milestone?.ordinal).at(-1)?.milestone.ordinal;
    if (ordinal && ((previousOrdinal && ordinal < previousOrdinal) || (series.expectedCount && ordinal > series.expectedCount))) fail('milestone reverses or exceeds campaign bounds');
  } else if (proposal.decision === 'new-series') {
    assertSchema(proposal.candidateSeriesId, expanded(proposalSchema.$defs.slug));
    if (input.registry.some(s => s.id === proposal.candidateSeriesId) || proposal.comparedClaims.some(c => c.disposition === 'same-target') || proposal.previousIdentity || proposal.novelty.previousArticle) fail('new series collides with registry or known continuation');
  } else if (proposal.candidateSeriesId && !input.registry.some(s => s.id === proposal.candidateSeriesId)) fail('nonpositive candidate absent');
}

export function evaluateSeriesProposals(checkout, {input, report, folder, evidence, submission, expectedProposalDigest}, current, now = new Date()) {
  // expectedProposalDigest is pinned outside the submission by its receiver.
  // Recomputing a self-declared hash is never treated as trusted authentication.
  if (!/^[a-f0-9]{64}$/.test(expectedProposalDigest || '') || hash(submission) !== expectedProposalDigest) fail('proposal digest differs from independently pinned submission');
  assertSchema(submission, expanded(proposalSchema));
  const trustedInput = createSeriesInput(checkout, report, current, now);
  if (canonical(input) !== canonical(trustedInput) || input.status !== 'awaiting-editorial') fail('stale registry, source report or ineligible morning input');
  // Preserve ALL existing morning/source/package/history checks. Never call apply.
  const morning = evaluateDraft(checkout, report, folder, evidence, current, now), bundle = readDraft(folder);
  if (canonical(submission.binding) !== canonical(proposalBinding(input, bundle, evidence))) fail('registry-source-package-run-attempt-base binding mismatch');
  const ids = new Set(), articles = new Set(), events = new Set(), deltas = new Set();
  for (const proposal of submission.proposals) {
    if (ids.has(proposal.id) || articles.has(proposal.article) || events.has(proposal.event.key)) fail('duplicate proposal/article/event');
    ids.add(proposal.id); articles.add(proposal.article); events.add(proposal.event.key);
    validateOne(proposal, input, bundle, evidence);
    if (['existing-update','new-series'].includes(proposal.decision)) {
      const key = canonical([proposal.identity, normalizeText(proposal.novelty.delta)]);
      if (deltas.has(key)) fail('duplicate identity/delta proposal');
      deltas.add(key);
    }
  }
  const metrics = {...emptyMetrics(), proposalCount: submission.proposals.length, decisions: decisionCounts(submission.proposals),
    ambiguous: submission.proposals.filter(p => p.decision === 'needs-review' || p.comparedCandidates.some(c => c.disposition === 'ambiguous')).length,
    coverage: {proposed: articles.size, eligible: bundle.articles.length, ratio: articles.size / bundle.articles.length}, sourceCoverage: report.research.coverage || {}, sourceFailures: report.research.failures.length};
  return {version: 1, status: 'proposal-valid', mode: 'read-only', binding: submission.binding, proposalDigest: expectedProposalDigest,
    morningStatus: morning.status, eligibleArticles: bundle.articles.map(a => a.slug), evaluatedAt: jst(now), metrics, publicationAuthorized: false, registrationAuthorized: false};
}

export function humanMetrics(evaluation, submission, labels) {
  if (evaluation.proposalDigest !== hash(submission)) fail('evaluation/submission digest mismatch');
  if (!labels) return evaluation.metrics;
  assertSchema(labels, labelSchema, 'series-labels');
  const exactKeys = (object, keys) => object && canonical(Object.keys(object).sort()) === canonical(keys.slice().sort());
  if (!exactKeys(labels, ['version','evaluationDigest','reviewer','reviewedAt','items']) || labels.version !== 1 || labels.evaluationDigest !== hash(evaluation) || !labels.reviewer?.trim() || !isJST(labels.reviewedAt) || Date.parse(labels.reviewedAt) < Date.parse(evaluation.evaluatedAt) || !Array.isArray(labels.items)) fail('human labels not bound to evaluation/reviewer/time');
  const articles = new Set(); let falseMerge = 0, missedContinuation = 0, duplicateProposal = 0, ambiguous = 0;
  for (const item of labels.items) {
    if (!exactKeys(item, ['article','expectedDecision','expectedSeriesId','duplicate','ambiguous']) || !evaluation.eligibleArticles.includes(item.article) || articles.has(item.article) || !decisions.includes(item.expectedDecision) || typeof item.expectedSeriesId !== 'string' || typeof item.duplicate !== 'boolean' || typeof item.ambiguous !== 'boolean' || (item.expectedDecision === 'existing-update' && !item.expectedSeriesId)) fail('invalid or duplicate human label');
    articles.add(item.article);
    const actual = submission.proposals.find(p => p.article === item.article);
    falseMerge += Number(actual?.decision === 'existing-update' && (item.expectedDecision !== 'existing-update' || actual.candidateSeriesId !== item.expectedSeriesId));
    missedContinuation += Number(item.expectedDecision === 'existing-update' && (actual?.decision !== 'existing-update' || actual.candidateSeriesId !== item.expectedSeriesId));
    duplicateProposal += Number(item.duplicate); ambiguous += Number(item.ambiguous);
  }
  const complete = articles.size === evaluation.eligibleArticles.length;
  return {...evaluation.metrics, humanLabel: complete ? 'evaluated' : 'partially-evaluated', labeledArticles: articles.size, falseMerge, missedContinuation, duplicateProposal, ambiguous};
}
