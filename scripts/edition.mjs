import {isDate} from './contract.mjs';

export const variants = ['morning', 'noon', 'evening'];
export const priceKey = row => JSON.stringify([row.sku, row.shop, row.condition, row.observed]);
export function editionIdentity(slug) {
  const match = typeof slug === 'string' && slug.match(/^(\d{4}-\d{2}-\d{2})(?:-(morning|noon|evening))?$/);
  if (!match || !isDate(match[1])) throw new Error('Invalid edition slug: expected YYYY-MM-DD[-morning|-noon|-evening]');
  return {date: match[1], slug, variant: match[2] || 'legacy'};
}
export function validateEditionIdentity(edition) {
  const identity = editionIdentity(edition.slug);
  if (identity.variant === 'legacy') {
    if (edition.date !== undefined || edition.variant !== undefined || edition.priceKeys !== undefined) throw new Error('Legacy editions must retain their original metadata');
  } else if (edition.date !== identity.date || edition.variant !== identity.variant || edition.kind !== 'daily' || !Array.isArray(edition.priceKeys)) {
    throw new Error('Edition date/variant must match its slug');
  }
  return identity;
}
export function validateEditionPrices(edition, prices) {
  const {date, variant} = validateEditionIdentity(edition);
  if (variant === 'legacy') return prices.filter(p => p.observed.slice(0,10) === date);
  if (new Set(edition.priceKeys).size !== edition.priceKeys.length) throw new Error('Duplicate edition price key');
  return edition.priceKeys.map(key => {
    const row = prices.find(p => priceKey(p) === key);
    if (!row || row.observed.slice(0,10) !== date || Date.parse(row.observed) > Date.parse(edition.published)) throw new Error('Edition price key is absent, out of date or after publication');
    return row;
  });
}
export const newestEdition = (a, b) => b.published.localeCompare(a.published) || b.slug.localeCompare(a.slug);
export function receiptIdentityMatches(item, identity) {
  // Old receipts remain readable only for the unqualified legacy identity.
  return item?.date === identity.date && (identity.variant === 'legacy'
    ? (item.slug === undefined || item.slug === identity.slug) && (item.variant === undefined || item.variant === 'legacy')
    : item.slug === identity.slug && item.variant === identity.variant);
}
