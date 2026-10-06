import fs from 'node:fs';
import {createHash} from 'node:crypto';

export const registry = JSON.parse(fs.readFileSync(new URL('../config/research-sources.json', import.meta.url), 'utf8'));
export const digest = text => createHash('sha256').update(text).digest('hex');
export const jst = value => new Date(new Date(value).getTime() + 9 * 3600000).toISOString().replace(/\.\d{3}Z$/, '+09:00');
export function approvedSource(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search) throw new Error('Source requires plain allowlisted HTTPS URL');
  const source = registry.sources.find(s => s.hosts.includes(url.hostname) && (!s.pathPrefix || url.pathname.startsWith(s.pathPrefix)));
  if (!source) throw new Error('Source outside reviewed primary registry');
  return source;
}
const entities = value => value.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, x) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[x]).replace(/&#(x[0-9a-f]+|\d+);/gi, (_, x) => {
  const n = x[0].toLowerCase() === 'x' ? parseInt(x.slice(1),16) : Number(x);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
});
export const normalizeText = text => text.replace(/\s+/g,' ').trim();
export function readableText(html) {
  return normalizeText(entities(html.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ')));
}
export function discoveryLinks(html, base) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(entities(match[1]), base); url.hash = '';
      approvedSource(url.href);
      const title = readableText(match[2]);
      if (title.length >= 8 && !links.some(l => l.url === url.href)) links.push({url:url.href,title:title.slice(0,200)});
    } catch { /* External/navigation/unsupported links are not evidence. */ }
    if (links.length === 40) break;
  }
  return links;
}
// No credentials, cookies, JS, arbitrary URLs, cross-host redirects or retry storms.
export async function fetchSource(url, {request = fetch, now = () => new Date(), maxBytes = 1024 * 1024} = {}) {
  const source = approvedSource(url), original = url;
  const signal = AbortSignal.timeout(15000); // Entire redirect/body operation, not per hop.
  for (let hop = 0; hop <= 3; hop++) {
    const response = await request(url, {redirect:'manual',signal,headers:{Accept:'text/html, application/xml, text/plain', 'User-Agent':'JAMIO-NEWS-shadow/1.0'},cache:'no-store'});
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || hop === 3) throw new Error('Source redirect limit');
      const target = new URL(location, url).href;
      if (approvedSource(target).id !== source.id) throw new Error('Source cross-publisher redirect');
      await response.body?.cancel(); url = target; continue;
    }
    if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
    if (!/^(text\/(html|plain)|application\/(xml|rss\+xml|atom\+xml))/i.test(response.headers.get('content-type') || '')) throw new Error('Unsupported source content type');
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Source size limit');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('Source size limit');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks);
    const declared = response.headers.get('content-type').match(/charset=["']?([\w-]+)/i)?.[1] || bytes.toString('ascii').match(/<meta[^>]*charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
    const html = new TextDecoder(declared,{fatal:true}).decode(bytes), text = readableText(html);
    if (text.length < 80 || /just a moment|verify you are human|access denied|enable javascript and cookies/i.test(text.slice(0,2000))) throw new Error('Source unreadable or access restricted');
    return {url:original,finalUrl:url,sourceId:source.id,category:source.category,type:source.type,checked:jst(now()),digest:digest(text),text,links:discoveryLinks(html,url)};
  }
}
export async function collectSources(urls = registry.sources.map(s => s.url), options = {}) {
  if (!Array.isArray(urls) || !urls.length || urls.length > 30 || new Set(urls).size !== urls.length) throw new Error('Research requires 1-30 unique source URLs');
  urls.forEach(approvedSource); // Validate everything before any network request.
  const snapshots = [], failures = [];
  // Small sequential bounded workload; per-source failure does not invent data.
  for (const url of urls) {
    try { snapshots.push(await fetchSource(url,options)); }
    catch (error) {
      const reason = /^(Source |Unsupported source |Source outside |Source requires )/.test(error.message) ? error.message : 'Source network, timeout or decoding failure';
      failures.push({url,reason});
    }
  }
  return {snapshots,failures,coverage: Object.fromEntries(['ai','hardware','vr','deals','local','life'].map(c => [c, snapshots.filter(s => s.category === c).length])),x:{status:'unavailable',note:'No authenticated X collection is configured; only fetched registry sources are recorded.'}};
}
