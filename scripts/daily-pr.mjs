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
export function guardGitPR(root, event) {
  const pr = event.pull_request;
  if (!pr || pr.base.ref !== 'main' || pr.head.repo?.full_name !== event.repository.full_name || pr.base.repo?.full_name !== event.repository.full_name) throw new Error('Daily PR must be a same-repository PR into main');
  const baseSha = pr.base.sha, headSha = pr.head.sha;
  if (![baseSha, headSha].every(s => /^[a-f0-9]{40}$/.test(s))) throw new Error('Invalid PR SHA');
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  git(['merge-base', '--is-ancestor', baseSha, headSha]); // Stale daily bases must be updated/revalidated.
  const fields = git(['diff', '--no-renames', '--name-status', '-z', baseSha, headSha]).split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < fields.length; i += 2) {
    const file = fields[i + 1];
    const mode = git(['ls-tree', headSha, '--', file]).split(' ')[0];
    changes.push({status: fields[i], file, mode});
  }
  guardPaths(pr.head.ref, changes); // Before reading any candidate content; never execute candidate code.
  const read = (sha, file) => git(['show', `${sha}:${file}`]);
  const load = sha => {
    const files = git(['ls-tree', '-r', '--name-only', sha]).split('\n');
    const content = prefix => files.filter(f => f.startsWith(prefix) && f.endsWith('.md')).map(f => parse(read(sha, f), path.basename(f)));
    return {config: JSON.parse(read(sha, 'site.config.json')), articles: content('content/articles/'), editions: content('content/editions/'), prices: JSON.parse(read(sha, 'data/prices.json'))};
  };
  const receipt = validateDailyChange(pr.head.ref, changes, load(baseSha), load(headSha));
  return {status: 'guard-passed', contractVersion: 1, pr: pr.number, baseSha, headSha, ...receipt};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = guardGitPR(process.cwd(), JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
    console.log('JAMIO_DAILY_VALIDATION ' + JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Daily publication validation\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
  } catch (error) { console.error(JSON.stringify({status: 'failed', error: error.message})); process.exitCode = 1; }
}
