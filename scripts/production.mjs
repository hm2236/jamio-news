import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertSchema} from './contract.mjs';
import {editionIdentity, validateEditionIdentity, validateEditionPrices, priceKey} from './edition.mjs';
import {parse, readContent, validate, validatePrices, markdown} from './content.mjs';

export const canonical = value => JSON.stringify(sortKeys(value));
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
  return value;
}
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const serialize = ({slug, body, ...metadata}) => `---\n${JSON.stringify(metadata, null, 2)}\n---\n${body}`;
export const observationKey = priceKey;
export function loadRepository(root) {
  const config = readJSON(path.join(root, 'site.config.json'));
  const articles = readContent(path.join(root, 'content/articles'));
  const editions = readContent(path.join(root, 'content/editions'));
  const prices = readJSON(path.join(root, 'data/prices.json'));
  validate(articles, editions, config);
  validatePrices(prices);
  for (const edition of editions) validateEditionPrices(edition, prices);
  for (const item of [...articles, ...editions]) markdown(item.body);
  return {config, articles, editions, prices};
}
export function editionDigest(edition, articles, prices) {
  const selected = edition.articles.map(slug => articles.find(a => a.slug === slug));
  const observations = validateEditionPrices(edition, prices);
  return createHash('sha256').update(canonical({edition, articles: selected, prices: observations})).digest('hex');
}
export function editionURL(config, date) {
  editionIdentity(date);
  return new URL(`editions/${date}/`, config.url).href;
}
export function initDraft(root, date) {
  const identity = editionIdentity(date);
  const folder = path.join(root, 'drafts', date);
  if (fs.existsSync(folder)) throw new Error('Draft already exists; resume it without reinitializing');
  if (fs.existsSync(path.join(root, 'content/editions', `${date}.md`))) throw new Error('Edition already exists; confirm publication or make a separate correction PR');
  fs.mkdirSync(path.join(folder, 'articles'), {recursive: true});
  const label = {legacy:'朝刊',morning:'朝刊',noon:'昼刊',evening:'夕刊'}[identity.variant];
  const edition = {...(identity.variant === 'legacy' ? {} : {date:identity.date,variant:identity.variant,priceKeys:[]}), title: `じゃみお${label} — ${identity.date}`, kind: 'daily', published: `${identity.date}T07:00:00+09:00`, top5: [], hero: '', articles: [], deals: [], production: {contractVersion: 1, x: {status: 'not-used', note: ''}}, body: '\n'};
  fs.writeFileSync(path.join(folder, 'edition.md'), serialize(edition), {flag: 'wx'});
  fs.writeFileSync(path.join(folder, 'prices.json'), '[]\n', {flag: 'wx'});
  return {status: 'draft', ...identity, folder};
}
export function readDraft(folder) {
  folder = path.resolve(folder);
  const slug = path.basename(folder);
  const {date} = editionIdentity(slug);
  const names = fs.readdirSync(folder).sort();
  if (names.join(',') !== 'articles,edition.md,prices.json') throw new Error('Draft must contain only articles/, edition.md, prices.json');
  for (const name of names) if (fs.lstatSync(path.join(folder, name)).isSymbolicLink()) throw new Error('Draft symlinks are not supported');
  const articleFolder = path.join(folder, 'articles');
  for (const entry of fs.readdirSync(articleFolder, {withFileTypes: true})) if (!entry.isFile() || !entry.name.endsWith('.md')) throw new Error('Draft articles must be regular Markdown files');
  const edition = parse(fs.readFileSync(path.join(folder, 'edition.md'), 'utf8'), `${slug}.md`);
  const articles = readContent(articleFolder);
  const priceObservations = readJSON(path.join(folder, 'prices.json'));
  const bundle = {date, edition, articles, priceObservations};
  return validatePackage(bundle);
}
export function validatePackage(bundle) {
  const {date, edition, articles, priceObservations} = bundle;
  assertSchema(bundle);
  if (validateEditionIdentity(edition).date !== date || edition.published.slice(0,10) !== date) throw new Error('Package date and edition date must match');
  if (canonical(articles.map(a => a.slug).sort()) !== canonical(edition.articles.slice().sort())) throw new Error('Draft must contain exactly the edition articles');
  validatePrices(priceObservations);
  if (editionIdentity(edition.slug).variant !== 'legacy' && canonical(edition.priceKeys) !== canonical(priceObservations.map(priceKey))) throw new Error('Edition priceKeys must exactly match package observations in order');
  validateEditionPrices(edition, priceObservations);
  for (const row of priceObservations) if (row.observed.slice(0, 10) !== date || Date.parse(row.observed) > Date.parse(edition.published)) throw new Error('Price observations must be from this JST date, before edition publication');
  for (const item of [edition, ...articles]) markdown(item.body);
  return bundle;
}
export function planDraft(root, folder) {
  const bundle = readDraft(folder);
  const {date, edition, articles, priceObservations} = bundle;
  const existing = loadRepository(root);
  const writes = [];
  const mergedArticles = existing.articles.slice();
  for (const article of articles) {
    const prior = existing.articles.find(a => a.slug === article.slug);
    if (prior && canonical(prior) !== canonical(article)) throw new Error(`Article collision: ${article.slug}; use a correction PR`);
    if (!prior) { mergedArticles.push(article); writes.push({file: `content/articles/${article.slug}.md`, text: serialize(article)}); }
  }
  const priorEdition = existing.editions.find(e => e.slug === edition.slug);
  const mergedEditions = existing.editions.slice();
  if (priorEdition && canonical(priorEdition) !== canonical(edition)) throw new Error('Same-day edition conflict; use a correction PR');
  if (!priorEdition) { mergedEditions.push(edition); writes.push({file: `content/editions/${edition.slug}.md`, text: serialize(edition)}); }
  const prices = existing.prices.slice();
  for (const row of priceObservations) {
    const prior = prices.find(p => observationKey(p) === observationKey(row));
    if (prior && canonical(prior) !== canonical(row)) throw new Error('Price observation conflict; history cannot be overwritten');
    if (!prior) prices.push(row);
  }
  if (priorEdition && (writes.length || canonical(validateEditionPrices(edition, existing.prices)) !== canonical(priceObservations))) throw new Error('Same-day package conflict; published observations cannot change on retry');
  assertStableEditions(existing, {articles:mergedArticles, editions:mergedEditions, prices});
  validate(mergedArticles, mergedEditions, existing.config);
  validatePrices(prices);
  if (prices.length !== existing.prices.length) writes.push({file: 'data/prices.json', text: JSON.stringify(prices, null, 2) + '\n'});
  return {...editionIdentity(edition.slug), writes, editionUrl: editionURL(existing.config, edition.slug), digest: editionDigest(edition, mergedArticles, prices)};
}
export function applyDraft(root, folder) {
  const plan = planDraft(root, folder); // All validation/collisions finish before any write.
  const originals = new Map();
  try {
    for (const {file, text} of plan.writes) {
      const target = path.join(root, file);
      if (file === 'data/prices.json') {
        originals.set(target, fs.readFileSync(target));
        fs.writeFileSync(target, text);
      } else {
        const fd = fs.openSync(target, 'wx');
        originals.set(target, null);
        try { fs.writeFileSync(fd, text); } finally { fs.closeSync(fd); }
      }
    }
  } catch (error) {
    for (const [file, bytes] of [...originals].reverse()) {
      if (bytes === null) fs.rmSync(file, {force: true}); else fs.writeFileSync(file, bytes);
    }
    throw error;
  }
  return {status: plan.writes.length ? 'applied' : 'unchanged', date: plan.date, slug:plan.slug, variant:plan.variant, editionUrl: plan.editionUrl, digest: plan.digest, files: plan.writes.map(w => w.file)};
}

// An added variant must never rewrite the identity, content or digest of any prior issue.
export function assertStableEditions(base, candidate) {
  for (const edition of base.editions) {
    const next = candidate.editions.find(e => e.slug === edition.slug);
    if (!next || canonical(next) !== canonical(edition) || editionDigest(edition, base.articles, base.prices) !== editionDigest(next, candidate.articles, candidate.prices)) throw new Error('Existing edition digest/content would change: ' + edition.slug);
  }
}
