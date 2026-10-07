import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {editionIdentity} from './edition.mjs';
import {parse, validate, validatePrices} from './content.mjs';
import {canonical, validatePackage, editionDigest, editionURL, assertStableEditions} from './production.mjs';

export function dailyDate(branch) {
  return dailyIdentity(branch).date;
}
export function dailyIdentity(branch) {
  if (!branch?.startsWith('daily/')) throw new Error('Daily branch must be daily/<edition-slug>');
  return editionIdentity(branch.slice(6));
}
export function guardPaths(branch, changes) {
  const {date, slug} = dailyIdentity(branch);
  const article = new RegExp(`^content/articles/${slug}-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$`);
  for (const {status, file, mode} of changes) {
    const allowed = (status === 'A' && (article.test(file) || file === `content/editions/${slug}.md`)) || (status === 'M' && file === 'data/prices.json');
    if (!allowed || mode !== '100644') throw new Error(`Daily PR forbidden change: ${status} ${file} (${mode})`);
  }
  if (!changes.some(c => c.file === `content/editions/${slug}.md`)) throw new Error('Daily PR must add its edition; existing same-day editions cannot be overwritten');
  return date;
}
export function validateDailyChange(branch, changes, base, candidate) {
  const date = guardPaths(branch, changes);
  const {slug, variant} = dailyIdentity(branch);
  if (base.editions.some(e => e.slug === slug) || base.articles.some(a => a.slug.startsWith(slug + '-'))) throw new Error('Same-day content already exists; resume confirmation or use a separate correction PR');
  if (candidate.prices.length < base.prices.length || canonical(candidate.prices.slice(0, base.prices.length)) !== canonical(base.prices)) throw new Error('Price history must remain an unchanged prefix');
  const observations = candidate.prices.slice(base.prices.length);
  if (changes.some(c => c.file === 'data/prices.json') && !observations.length) throw new Error('prices.json may change only to append real observations');
  const edition = candidate.editions.find(e => e.slug === slug);
  const addedSlugs = changes.filter(c => c.status === 'A' && c.file.startsWith('content/articles/')).map(c => path.basename(c.file,'.md'));
  const articles = candidate.articles.filter(a => addedSlugs.includes(a.slug));
  assertStableEditions(base, candidate);
  validatePackage({date, edition, articles, priceObservations: observations});
  validate(candidate.articles, candidate.editions, candidate.config);
  validatePrices(candidate.prices);
  return {date, slug, variant, editionUrl: editionURL(candidate.config, slug), digest: editionDigest(edition, candidate.articles, candidate.prices)};
}
// All PRs are classified by trusted code, never by a workflow skip condition.
export function guardInfrastructurePaths(changes) {
  for (const {file} of changes) {
    if (file === 'content' || file.startsWith('content/') || file === 'data/prices.json') throw new Error('Non-daily PR changes protected publication data: ' + file + '; correction mode is not implemented');
  }
}
export function validateFreshness(branch, edition, articles, now = new Date()) {
  const {date} = dailyIdentity(branch);
  const timestamp = new Date(now).getTime();
  if (!Number.isFinite(timestamp)) throw new Error('Invalid validation clock');
  const today = new Date(timestamp + 9 * 3600000).toISOString().slice(0, 10);
  if (date !== today) throw new Error('Stale daily candidate: edition must be from the current JST date');
  for (const item of [edition, ...articles]) {
    if (!item || item.published?.slice(0, 10) !== date || !Number.isFinite(Date.parse(item.published)) || Date.parse(item.published) > timestamp) throw new Error('Candidate published time is future or mismatches its date');
  }
  return {validatedAt: new Date(timestamp).toISOString(), expiresAt: new Date(Date.parse(date + 'T00:00:00+09:00') + 86400000).toISOString()};
}
export function guardCandidateChain(branch, commits, baseSha, headSha) {
  const {slug} = dailyIdentity(branch), seal = 'content/editions/' + slug + '.md';
  if (!commits.length) throw new Error('Candidate has no edition seal');
  let parent = baseSha, sealed = false, attempt;
  const added = new Set();
  for (const commit of commits) {
    if (commit.parents.length !== 1 || commit.parents[0] !== parent) throw new Error('Candidate must be a linear chain from expected base; merge commits forbidden');
    if (sealed) throw new Error('Commit after edition seal is forbidden');
    if (!commit.changes.length) throw new Error('Empty candidate commit is forbidden');
    // Contents API v1 adds one file per commit. Single-commit local packages
    // retain the existing append-only price contract, checked below.
    const markers = commit.message.split('\n').filter(line => line.startsWith('Candidate-Attempt:'));
    if (commits.length > 1 || markers.length) {
      if (markers.length !== 1 || !/^Candidate-Attempt: [a-z0-9][a-z0-9-]{15,63}$/.test(markers[0])) throw new Error('Multi-commit candidate requires one valid Candidate-Attempt trailer per commit');
      if (!commit.message.trimEnd().endsWith(markers[0])) throw new Error('Candidate-Attempt must be a final trailer');
      if (attempt && markers[0] !== attempt) throw new Error('Mixed candidate attempts are forbidden');
      attempt = markers[0]; // Consistency only: unsigned trailers are not authentication.
      if (commits.length > 1 && commit.changes.length !== 1) throw new Error('Contents API candidate must add one file per commit');
    }
    for (const change of commit.changes) {
      if (change.file === 'data/prices.json' && commits.length === 1 && !markers.length) continue;
      if (change.status !== 'A' || change.mode !== '100644' || added.has(change.file)) throw new Error('Candidate commits must be add-only: ' + change.file);
      const allowed = change.file === seal || change.file.startsWith('content/articles/' + slug + '-');
      if (!allowed) throw new Error('Candidate contains unrelated publication attempt: ' + change.file);
      added.add(change.file);
      if (change.file === seal) sealed = true;
    }
    parent = commit.sha;
  }
  if (!sealed || parent !== headSha) throw new Error('Edition seal must be PR head');
  return {sealSha: headSha, candidateMode: commits.length === 1 ? 'single-commit' : 'contents-v1', ...(attempt ? {attempt: attempt.slice('Candidate-Attempt: '.length)} : {})};
}
export function guardGitPR(root, event, {now, latestMainSha} = {}) {
  const pr = event.pull_request;
  if (!pr || pr.base.ref !== 'main' || (pr.head.ref.startsWith('daily/') && pr.head.repo?.full_name !== event.repository.full_name) || pr.base.repo?.full_name !== event.repository.full_name) throw new Error('Daily PR must be a same-repository PR into main');
  const baseSha = pr.base.sha, headSha = pr.head.sha;
  if (![baseSha, headSha].every(s => /^[a-f0-9]{40}$/.test(s))) throw new Error('Invalid PR SHA');
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  const daily = pr.head.ref.startsWith('daily/');
  // Infrastructure branches may be behind main; use their actual PR diff.
  // Daily candidates must start at the current main with no merge-based update.
  const diffBase = daily ? baseSha : git(['merge-base', baseSha, headSha]).trim();
  if (daily) {
    latestMainSha ??= git(['rev-parse', 'origin/main']).trim();
    if (latestMainSha !== baseSha) throw new Error('Stale PR base: main advanced; recreate and revalidate candidate');
    git(['merge-base', '--is-ancestor', baseSha, headSha]);
  }
  const fields = git(['diff', '--no-renames', '--name-status', '-z', diffBase, headSha]).split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < fields.length; i += 2) {
    const file = fields[i + 1];
    const mode = git(['ls-tree', headSha, '--', file]).split(' ')[0];
    changes.push({status: fields[i], file, mode});
  }
  if (!daily) {
    guardInfrastructurePaths(changes);
    return {status: 'infrastructure-passed', contractVersion: 1, pr: pr.number, baseSha, headSha};
  }
  guardPaths(pr.head.ref, changes); // Before reading any candidate content; never execute candidate code.
  const read = (sha, file) => git(['show', `${sha}:${file}`]);
  const load = sha => {
    const files = git(['ls-tree', '-r', '--name-only', sha]).split('\n');
    const content = prefix => files.filter(f => f.startsWith(prefix) && f.endsWith('.md')).map(f => parse(read(sha, f), path.basename(f)));
    return {config: JSON.parse(read(sha, 'site.config.json')), articles: content('content/articles/'), editions: content('content/editions/'), prices: JSON.parse(read(sha, 'data/prices.json'))};
  };
  const commits = git(['rev-list', '--reverse', baseSha + '..' + headSha]).trim().split('\n').filter(Boolean).map(sha => {
    const parents = git(['show', '-s', '--format=%P', sha]).trim().split(' ').filter(Boolean);
    const fields = git(['diff', '--no-renames', '--name-status', '-z', parents[0], sha]).split('\0').filter(Boolean);
    const changes = [];
    for (let i = 0; i < fields.length; i += 2) {
      const file = fields[i + 1], mode = git(['ls-tree', sha, '--', file]).split(' ')[0];
      changes.push({status: fields[i], file, mode});
    }
    return {sha, parents, changes, message: git(['show', '-s', '--format=%B', sha])};
  });
  const seal = guardCandidateChain(pr.head.ref, commits, baseSha, headSha);
  const candidate = load(headSha);
  const receipt = validateDailyChange(pr.head.ref, changes, load(baseSha), candidate);
  const freshness = validateFreshness(pr.head.ref, candidate.editions.find(e => e.slug === receipt.slug), candidate.articles.filter(a => a.slug.startsWith(receipt.slug + '-')), now ?? new Date());
  return {status: 'guard-passed', contractVersion: 1, pr: pr.number, baseSha, headSha, ...receipt, ...seal, ...freshness};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = guardGitPR(process.cwd(), JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
    console.log('JAMIO_DAILY_VALIDATION ' + JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Daily publication validation\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
  } catch (error) { console.error(JSON.stringify({status: 'failed', error: error.message})); process.exitCode = 1; }
}
