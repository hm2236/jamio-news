import fs from 'node:fs';
import {editionIdentity, validateEditionIdentity} from './edition.mjs';

export const contract = JSON.parse(fs.readFileSync(new URL('../contracts/publishing.schema.json', import.meta.url), 'utf8'));
export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isJST(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\+09:00$/.test(value) && isDate(value.slice(0, 10));
}
export const isX = source => source.type === 'x' || /(^|\.)(x|twitter)\.com$/.test(new URL(source.url).hostname.replace(/\.$/, ''));
export function sourceURL(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, '');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      !/(^|\.)(example\.(com|org|net)|localhost|invalid|test)$/.test(host) && !['127.0.0.1', '[::1]'].includes(host);
  } catch { return false; }
}

// Evaluates exactly the assertion keywords used by our checked-in schema.
// Standard validators can consume it too; custom formats above must be registered.
export function assertSchema(value, schema = contract, location = '$') {
  const fail = message => { throw new Error(`${location}: ${message}`); };
  if (schema.$ref) assertSchema(value, contract.$defs[schema.$ref.split('/').at(-1)], location);
  if (schema.type) {
    const valid = schema.type === 'array' ? Array.isArray(value) : schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : schema.type === 'integer' ? Number.isSafeInteger(value) : typeof value === schema.type;
    if (!valid) fail(`expected ${schema.type}`);
  }
  if ('const' in schema && value !== schema.const) fail(`expected ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) fail('invalid enum value');
  if (schema.minimum !== undefined && value < schema.minimum) fail('below minimum');
  if (schema.minLength !== undefined && value.length < schema.minLength) fail('empty string');
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('invalid string');
  if (schema.format && !({date: isDate, 'jst-date-time': isJST, 'source-url': sourceURL, 'edition-slug': value => {try {editionIdentity(value); return true;} catch {return false;}}})[schema.format](value)) fail(`invalid ${schema.format}`);
  if (schema.required) for (const key of schema.required) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
  if (schema.properties) for (const [key, item] of Object.entries(value)) {
    if (Object.hasOwn(schema.properties, key)) assertSchema(item, schema.properties[key], `${location}.${key}`);
    else if (schema.additionalProperties === false) fail(`unknown property ${key}`);
  }
  if (schema.minItems !== undefined && value.length < schema.minItems) fail('too few items');
  if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('too many items');
  if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) fail('duplicate items');
  if (schema.items) value.forEach((item, i) => assertSchema(item, schema.items, `${location}[${i}]`));
}

export function validateDailyEdition(articles, edition) {
  const {date} = validateEditionIdentity(edition);
  const selected = edition.articles.map(slug => articles.find(a => a.slug === slug));
  assertSchema({date, edition, articles: selected, priceObservations: []});
  if (edition.published.slice(0, 10) !== date) throw new Error('Edition date must match JST published');
  for (const article of selected) {
    if (!article.slug.startsWith(edition.slug + '-') || article.published.slice(0, 10) !== date || Date.parse(article.published) > Date.parse(edition.published)) throw new Error('Daily articles must belong to this date and precede the edition');
    if (Boolean(article.updated) !== Boolean(article.corrections) || (article.updated && Date.parse(article.updated) < Date.parse(article.published))) throw new Error('Corrections require updated and corrections together');
    for (const source of article.sources) {
      if (Date.parse(source.checked) > Date.parse(article.updated || article.published)) throw new Error('Source checked time cannot follow article publication/update');
      if (isX(source)) {
        if (!['available', 'partial'].includes(edition.production.x.status)) throw new Error('Cannot claim X retrieval when X is unavailable/not-used');
        for (const key of ['author', 'postPublished', 'claim', 'identityNote']) if (!source[key]) throw new Error(`X source requires ${key}`);
        if (Date.parse(source.postPublished) > Date.parse(source.checked)) throw new Error('X post cannot follow its checked time');
      }
    }
  }
}
