import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertSchema, isDate} from './contract.mjs';
import {parse, readContent, validate, validatePrices, markdown} from './content.mjs';

export const canonical = value => JSON.stringify(sortKeys(value));
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
  return value;
}
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const serialize = ({slug, body, ...metadata}) => `---\n${JSON.stringify(metadata, null, 2)}\n---\n${body}`;
export const observationKey = row => canonical([row.sku, row.shop, row.condition, row.observed]);
export function loadRepository(root) {
  const config = readJSON(path.join(root, 'site.config.json'));
  const articles = readContent(path.join(root, 'content/articles'));
  const editions = readContent(path.join(root, 'content/editions'));
  const prices = readJSON(path.join(root, 'data/prices.json'));
  validate(articles, editions, config);
  validatePrices(prices);
  for (const item of [...articles, ...editions]) markdown(item.body);
  return {config, articles, editions, prices};
}
export function editionDigest(edition, articles, prices) {
  const selected = edition.articles.map(slug => articles.find(a => a.slug === slug));
  const observations = prices.filter(p => p.observed.slice(0, 10) === edition.slug);
  return createHash('sha256').update(canonical({edition, articles: selected, prices: observations})).digest('hex');
}
export function editionURL(config, date) {
  if (!isDate(date)) throw new Error('Invalid edition date');
  return new URL(`editions/${date}/`, config.url).href;
}
export function initDraft(root, date) {
  if (!isDate(date)) throw new Error('Date must be a real YYYY-MM-DD');
  const folder = path.join(root, 'drafts', date);
  if (fs.existsSync(folder)) throw new Error('Draft already exists; resume it without reinitializing');
  if (fs.existsSync(path.join(root, 'content/editions', `${date}.md`))) throw new Error('Edition already exists; confirm publication or make a separate correction PR');
  fs.mkdirSync(path.join(folder, 'articles'), {recursive: true});
  const edition = {title: `じゃみお朝刊 — ${date}`, kind: 'daily', published: `${date}T07:00:00+09:00`, top5: [], hero: '', articles: [], deals: [], production: {contractVersion: 1, x: {status: 'not-used', note: ''}}, body: '\n'};
  fs.writeFileSync(path.join(folder, 'edition.md'), serialize(edition), {flag: 'wx'});
  fs.writeFileSync(path.join(folder, 'prices.json'), '[]\n', {flag: 'wx'});
  return {status: 'draft', date, folder};
}
export function readDraft(folder) {
  folder = path.resolve(folder);
  const date = path.basename(folder);
  if (!isDate(date)) throw new Error('Draft folder must be named YYYY-MM-DD');
  const names = fs.readdirSync(folder).sort();
  if (names.join(',') !== 'articles,edition.md,prices.json') throw new Error('Draft must contain only articles/, edition.md, prices.json');
  for (const name of names) if (fs.lstatSync(path.join(folder, name)).isSymbolicLink()) throw new Error('Draft symlinks are not supported');
  const articleFolder = path.join(folder, 'articles');
  for (const entry of fs.readdirSync(articleFolder, {withFileTypes: true})) if (!entry.isFile() || !entry.name.endsWith('.md')) throw new Error('Draft articles must be regular Markdown files');
  const edition = parse(fs.readFileSync(path.join(folder, 'edition.md'), 'utf8'), `${date}.md`);
  const articles = readContent(articleFolder);
  const priceObservations = readJSON(path.join(folder, 'prices.json'));
  const bundle = {date, edition, articles, priceObservations};
  return validatePackage(bundle);
}
export function validatePackage(bundle) {
  const {date, edition, articles, priceObservations} = bundle;
  assertSchema(bundle);
  if (edition.slug !== date) throw new Error('Package date and edition date must match');
  if (canonical(articles.map(a => a.slug).sort()) !== canonical(edition.articles.slice().sort())) throw new Error('Draft must contain exactly the edition articles');
  validatePrices(priceObservations);
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
  const priorEdition = existing.editions.find(e => e.slug === date);
  const mergedEditions = existing.editions.slice();
  if (priorEdition && canonical(priorEdition) !== canonical(edition)) throw new Error('Same-day edition conflict; use a correction PR');
  if (!priorEdition) { mergedEditions.push(edition); writes.push({file: `content/editions/${date}.md`, text: serialize(edition)}); }
  const prices = existing.prices.slice();
  for (const row of priceObservations) {
    const prior = prices.find(p => observationKey(p) === observationKey(row));
    if (prior && canonical(prior) !== canonical(row)) throw new Error('Price observation conflict; history cannot be overwritten');
    if (!prior) prices.push(row);
  }
  if (priorEdition && (writes.length || canonical(existing.prices.filter(p => p.observed.slice(0, 10) === date)) !== canonical(priceObservations))) throw new Error('Same-day package conflict; published observations cannot change on retry');
  validate(mergedArticles, mergedEditions, existing.config);
  validatePrices(prices);
  if (prices.length !== existing.prices.length) writes.push({file: 'data/prices.json', text: JSON.stringify(prices, null, 2) + '\n'});
  return {date, writes, editionUrl: editionURL(existing.config, date), digest: editionDigest(edition, mergedArticles, prices)};
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
  return {status: plan.writes.length ? 'applied' : 'unchanged', date: plan.date, editionUrl: plan.editionUrl, digest: plan.digest, files: plan.writes.map(w => w.file)};
}
