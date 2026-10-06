import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {brotliCompressSync, brotliDecompressSync, constants as zlibConstants} from 'node:zlib';
import {fileURLToPath} from 'node:url';

export const WORKFLOW = '.github/workflows/discovery-radar-shadow.yml';
export const REPOSITORY = 'hm2236/jamio-news';
export const ROLLING_BUDGET = 512 * 1024;
export const CHECKPOINT_BUDGET = 256 * 1024;
const WINDOW = 90 * 86400000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = code => { throw new Error(code); };
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) fail('invalid-canonical-value');
  return JSON.stringify(value);
}
export const digest = value => 'sha256:' + createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const iso = value => new Date(value).toISOString();
const validTime = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const contract = JSON.parse(fs.readFileSync(path.join(root,'contracts/discovery-radar.schema.json'),'utf8'));
export function validateContract(value, name) {
  const check = (v,s) => {
    if (s.$ref) return check(v,contract.$defs[s.$ref.split('/').at(-1)]);
    if (s.anyOf) { for (const branch of s.anyOf) { try { check(v,branch); return; } catch {} } fail('schema-union'); }
    if (Object.hasOwn(s,'const') && v !== s.const || s.enum && !s.enum.includes(v)) fail('schema-value');
    if (s.type === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) fail('schema-object');
      if (s.required?.some(k => !Object.hasOwn(v,k)) || s.maxProperties && Object.keys(v).length > s.maxProperties) fail('schema-required');
      for (const [k,x] of Object.entries(v)) {
        if (s.propertyNames) check(k,s.propertyNames);
        if (s.properties?.[k]) check(x,s.properties[k]);
        else if (s.additionalProperties === false) fail('schema-unknown-field');
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') check(x,s.additionalProperties);
      }
    } else if (s.type === 'array') {
      if (!Array.isArray(v) || v.length > (s.maxItems ?? Infinity)) fail('schema-array'); v.forEach(x => check(x,s.items));
    } else if (s.type === 'string') {
      if (typeof v !== 'string' || [...v].length < (s.minLength ?? 0) || [...v].length > (s.maxLength ?? Infinity) || s.pattern && !new RegExp(s.pattern).test(v)) fail('schema-string');
      if (s.format === 'date-time' && (!validTime(v) || !/^\d{4}-\d{2}-\d{2}T/.test(v))) fail('schema-time');
      if (s.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !validTime(v) || iso(v).slice(0,10) !== v)) fail('schema-time');
      if (s.format === 'uri') { try { new URL(v); } catch { fail('schema-url'); } }
    } else if (['integer','number'].includes(s.type)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || s.type === 'integer' && !Number.isInteger(v) || v < (s.minimum ?? -Infinity) || v > (s.maximum ?? Infinity)) fail('schema-number');
    } else if (s.type === 'boolean' && typeof v !== 'boolean' || s.type === 'null' && v !== null) fail('schema-type');
  };
  if (!contract.$defs[name]) fail('schema-definition'); check(value,contract.$defs[name]); return value;
}
const keys = (o, allowed) => { if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some(k => !allowed.includes(k))) fail('unknown-field'); };
const text = (s, max = 1024) => { if (typeof s !== 'string' || [...s].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) fail('field-bound'); return s.replace(/\s+/g, ' ').trim(); };
export function decode(s) {
  return s.replace(/&([^;\s]+);/g, (_, e) => {
    const basic = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '};
    if (Object.hasOwn(basic, e)) return basic[e];
    if (!/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(e)) fail('unknown-entity');
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    if (!n || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff || n < 32 && ![9,10,13].includes(n)) fail('invalid-entity');
    return String.fromCodePoint(n);
  });
}

// Conservative public unicast boundary, including IPv4-mapped IPv6 and special-use IPv6.
export function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99 || b === 31 && c === 196 || b === 52 && c === 193 || b === 175 && c === 48) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (net.isIP(address) !== 6) return false;
  // Only global 2000::/3; deny IANA protocol assignments, documentation and 6to4.
  const [first, second] = address.split(':').map(x => parseInt(x || '0',16));
  return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && second <= 0x1ff) && !(first === 0x2001 && second === 0xdb8) && !(first === 0x2620 && second === 0x4f) && first !== 0x2002 && first !== 0x3fff;
}
export function endpointAllowed(url, source) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false;
  if (source.id === 'hn-new') return u.hostname === 'hacker-news.firebaseio.com' && /^\/v0\/(?:newstories|item\/[1-9][0-9]*)\.json$/.test(u.pathname);
  return u.href === ({'kagoshima-new':'https://www.pref.kagoshima.jp/saishin/saishin.xml','anthropic-news':'https://www.anthropic.com/news'})[source.id];
}
export function validateSourceConfig(config) {
  keys(config,['version','sources']);
  if (config.version !== 1 || !Array.isArray(config.sources) || config.sources.length !== 3) fail('source-config');
  const reviewed = [
    ['hn-new','hn-item-v1','discover','aggregator',3600,262144,['application/json']],
    ['kagoshima-new','kagoshima-feed-v1','sentinel','authority-local',3600,262144,['text/xml','application/xml','application/rss+xml','application/atom+xml','application/rdf+xml']],
    ['anthropic-news','anthropic-index-v1','watch','publisher',7200,1048576,['text/html']]
  ];
  for (let i = 0; i < reviewed.length; i++) {
    const s = config.sources[i], [id,adapter,lane,channelClass,cadenceSeconds,maxBytes,contentTypes] = reviewed[i];
    keys(s,['id','adapter','lane','channelClass','cadenceSeconds','maxItems','endpoint','maxBytes','contentTypes','retentionClass','httpsEquivalence']);
    if (s.id !== id || s.adapter !== adapter || s.lane !== lane || s.channelClass !== channelClass || s.cadenceSeconds !== cadenceSeconds || s.maxBytes !== maxBytes || canonical(s.contentTypes) !== canonical(contentTypes) || s.retentionClass !== 'metadata-90d' || !Number.isInteger(s.maxItems) || s.maxItems < 1 || s.maxItems > (id === 'hn-new' ? 1 : 20) || !endpointAllowed(s.endpoint,s)) fail('source-config');
  }
  return config;
}
export async function pinnedRequest(url, {addresses, headers = {}, timeoutMs = 8000, maxBytes, request = https.request}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error, value) => { if (!settled) { settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); } };
    const selected = addresses[0];
    const req = request(url, {method:'GET', agent:false, headers,
      lookup: (_host, options, callback) => options?.all ? callback(null,[selected]) : callback(null,selected.address,selected.family)
    }, res => {
      const chunks = []; let size = 0;
      if (Number(res.headers['content-length']) > maxBytes) { req.destroy(); return done(new Error('response-size')); }
      res.on('data', b => { size += b.length; if (size > maxBytes) { req.destroy(); done(new Error('response-size')); } else chunks.push(b); });
      res.on('end', () => done(null,{status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks), bytes:size}));
      res.on('error', () => done(new Error('transport-error')));
    });
    const timer = setTimeout(() => { req.destroy(); done(new Error('timeout')); }, timeoutMs);
    req.on('error', () => done(new Error('transport-error'))); req.end();
  });
}
export function createSourceFetcher({resolver = host => dns.lookup(host,{all:true}), transport = pinnedRequest, clock = () => new Date()} = {}) {
  const stats = {requests:0, bytes:0};
  const fetchBody = async (url, source) => {
    for (let hop = 0; hop <= 2; hop++) {
      if (!endpointAllowed(url,source)) fail('endpoint-policy');
      const addresses = await resolver(new URL(url).hostname);
      if (!addresses.length || addresses.some(x => !publicAddress(x.address) || net.isIP(x.address) !== x.family)) fail('dns-policy');
      stats.requests++;
      const r = await transport(url,{addresses,timeoutMs:8000,maxBytes:source.maxBytes,headers:{Accept:source.contentTypes.join(', '),'User-Agent':'JAMIO-Discovery-Shadow/0A','Accept-Encoding':'identity'}});
      if (!Buffer.isBuffer(r.body) || r.body.length > source.maxBytes) fail('response-size');
      stats.bytes += r.body.length;
      if ([301,302,303,307,308].includes(r.status)) {
        if (hop === 2 || !r.headers.location) fail('redirect-policy');
        const next = new URL(r.headers.location,url);
        if (next.hostname !== new URL(url).hostname || !endpointAllowed(next.href,source)) fail('redirect-policy');
        url = next.href; continue;
      }
      if (r.status !== 200) fail('http-status');
      const type = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!source.contentTypes.includes(type) || r.headers['content-encoding'] && r.headers['content-encoding'] !== 'identity') fail('content-type');
      const capturedAt = iso(clock());
      let body; try { body = new TextDecoder('utf-8',{fatal:true}).decode(r.body); } catch { fail('invalid-utf8'); }
      return {body,capturedAt,finalUrl:url};
    }
  };
  return {fetchBody,stats};
}

export function sourceTime(value) {
  if (!value) return {at:null,precision:'unknown'};
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && iso(value).slice(0,10) === value) return {at:value,precision:'date'};
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && validTime(value)) return {at:iso(value),precision:'datetime'};
  if (/^(?:[A-Z][a-z]{2}, )?\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} (?:GMT|UT|[+-]\d{4})$/.test(value) && validTime(value)) return {at:iso(value),precision:'datetime'};
  fail('source-time');
}
export function hnRecord(item, expectedId) {
  if (item === null) return {status:'missing'};
  if (!item || Array.isArray(item) || item.id !== expectedId || !Number.isSafeInteger(item.id) || !['story','job','comment','poll','pollopt'].includes(item.type)) fail('hn-shape');
  if (item.deleted === true || item.dead === true) return {status:item.deleted ? 'deleted' : 'dead'};
  if (!['story','job'].includes(item.type)) return {status:'unsupported-type'};
  if (!Number.isSafeInteger(item.time) || item.time < 0) fail('hn-time');
  const url = item.url === undefined ? null : text(item.url,2048);
  // Untrusted discovery data is neither a canonical identity nor a network target.
  if (url) { let u; try { u = new URL(url); } catch { fail('hn-url'); } if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search) fail('hn-url-policy'); }
  return {status:'ok',record:{sourceItemId:String(item.id),canonicalUrl:`https://news.ycombinator.com/item?id=${item.id}`,sourceUrl:null,title:text(item.title),published:iso(item.time * 1000),updated:null,precision:'datetime',discoveredUrls:url ? [url] : [],semantic:{id:item.id,type:item.type,by:text(item.by || '',128),time:item.time,title:text(item.title),url,text:text(item.text || '',8192),dead:false,deleted:false}}};
}

// Small XML tokenizer with a checked stack, not a regex-only item extractor.
export function parseXml(body) {
  if (Buffer.byteLength(body) > 262144 || /<!DOCTYPE|<!ENTITY/i.test(body)) fail('xml-declaration');
  const document = {name:'#document',attrs:{},children:[],text:''}; const stack = [document];
  let i = 0, nodes = 0;
  const append = s => { if (s.includes('&') && /&(?![^;\s]+;)/.test(s)) fail('xml-entity'); stack.at(-1).text += decode(s); if (stack.at(-1).text.length > 16384) fail('xml-field-bound'); };
  while (i < body.length) {
    if (body[i] !== '<') { const end = body.indexOf('<',i); const j = end < 0 ? body.length : end; append(body.slice(i,j)); i = j; continue; }
    if (body.startsWith('<!--',i)) { const j = body.indexOf('-->',i+4); if (j < 0 || body.slice(i+4,j).includes('--')) fail('xml-comment'); i = j+3; continue; }
    if (body.startsWith('<![CDATA[',i)) { const j = body.indexOf(']]>',i+9); if (j < 0 || stack.length === 1) fail('xml-cdata'); stack.at(-1).text += body.slice(i+9,j); if (stack.at(-1).text.length > 16384) fail('xml-field-bound'); i = j+3; continue; }
    if (body.startsWith('<?xml',i) && stack.length === 1 && !document.children.length) { const j = body.indexOf('?>',i); if (j < 0) fail('xml-prolog'); i = j+2; continue; }
    const end = body.indexOf('>',i); if (end < 0 || end-i > 4096) fail('xml-tag');
    const token = body.slice(i+1,end); i = end+1;
    if (token.startsWith('/')) { if (!/^\/[A-Za-z_][\w:.-]*\s*$/.test(token) || stack.length === 1 || token.slice(1).trim() !== stack.at(-1).name) fail('xml-unclosed'); stack.pop(); continue; }
    const m = /^([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)$/.exec(token); if (!m) fail('xml-tag');
    const name = m[1], attrs = {}; let rest = m[2];
    while (rest.trim()) { const a = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(rest); if (!a || Object.hasOwn(attrs,a[1])) fail('xml-attribute'); attrs[a[1]] = decode(a[2] ?? a[3]); rest = rest.slice(a[0].length); }
    const namespace = {...stack.at(-1).namespace,xml:'http://www.w3.org/XML/1998/namespace'};
    for (const [key,value] of Object.entries(attrs)) if (key.startsWith('xmlns:')) namespace[key.slice(6)] = value;
    for (const qualified of [name,...Object.keys(attrs)]) if (qualified.includes(':') && !qualified.startsWith('xmlns:') && !namespace[qualified.split(':')[0]]) fail('xml-namespace');
    const local = name.split(':').at(-1);
    if (['item','entry'].includes(local) && stack.some(x => ['item','entry'].includes(x.name.split(':').at(-1)))) fail('xml-nested-item');
    if (++nodes > 4096 || stack.length > 16) fail('xml-structure-bound');
    const node = {name,attrs,children:[],text:'',namespace}; stack.at(-1).children.push(node); if (!m[3]) stack.push(node);
  }
  if (stack.length !== 1 || document.children.length !== 1 || document.text.trim()) fail('xml-unclosed');
  return document.children[0];
}
export function feedRecords(body, source, onReview) {
  const tree = parseXml(body), local = n => n.name.split(':').at(-1);
  if (!['rss','feed','RDF'].includes(local(tree))) fail('xml-dialect');
  if (local(tree) === 'rss' && tree.attrs.version !== '2.0' || local(tree) === 'RDF' && tree.attrs['xmlns:rdf'] !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' || local(tree) === 'feed' && tree.attrs.xmlns !== 'http://www.w3.org/2005/Atom') fail('xml-dialect');
  const nodes = []; const visit = n => { if (['item','entry'].includes(local(n))) nodes.push(n); else n.children.forEach(visit); }; visit(tree);
  if (nodes.length > 100) fail('xml-item-bound');
  const records = nodes.map(n => {
    const field = names => { const found = n.children.filter(x => names.includes(local(x))); if (found.length > 1) fail('xml-duplicate-field'); const x = found[0]; if (x?.children.length) fail('xml-field-structure'); return x; };
    const value = names => text(field(names)?.text || '',4096);
    const l = field(['link']); const link = l?.attrs.href || l?.text.trim();
    if (!link || !value(['title'])) fail('xml-item-shape');
    const sourceUrl = new URL(link,source.endpoint).href, u = new URL(sourceUrl);
    if (u.hostname !== 'www.pref.kagoshima.jp' || u.username || u.password || u.port || u.search || u.hash || !['https:','http:'].includes(u.protocol)) fail('feed-url-policy');
    if (u.protocol === 'http:') {
      const proof = source.httpsEquivalence?.find(x => x.sourceUrl === sourceUrl && x.httpsUrl === sourceUrl.replace(/^http:/,'https:') && x.method === 'visible-text-and-canonical-url' && x.httpStatus === 200 && x.httpsStatus === 200 && hashPattern.test(x.normalizedTextDigest) && validTime(x.verifiedAt));
      if (!proof) { if (onReview) { onReview('https-equivalence-needs-review'); return null; } fail('https-equivalence-needs-review'); } u.protocol = 'https:';
    }
    const published = sourceTime(value(['pubDate','published','date']) || null), updated = sourceTime(value(['updated']) || null);
    const sourceItemId = value(['guid','id']) || n.attrs['rdf:about'] || null;
    const title = text(value(['title']),1024), description = value(['description','summary']);
    return {sourceItemId,canonicalUrl:u.href,sourceUrl,title,published:published.at,updated:updated.at,precision:published.precision,discoveredUrls:[],semantic:{sourceItemId,link:u.href,title,published:published.at,updated:updated.at,description}};
  });
  return records.filter(Boolean).slice(0,source.maxItems);
}
export function htmlRecords(body, source) {
  if (!/<html\b/i.test(body) || !/<\/html>/i.test(body) || !/<\/body>/i.test(body)) fail('parser-drift');
  const records = [], seen = new Set();
  const clean = s => text(decode(s.replace(/<[^>]*>/g,' ')),1024);
  const anchors = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(m => /PublicationList[^"']*__listItem/.test(m[1]));
  if (!anchors.length || anchors.length > 200) fail('parser-drift');
  for (const m of anchors) {
    const href = /\bhref="([^"]+)"/.exec(m[1])?.[1];
    const title = /<span\b[^>]*class="[^"\n]*PublicationList[^"\n]*__title[^"\n]*"[^>]*>([\s\S]*?)<\/span>/i.exec(m[2])?.[1];
    const date = /<time\b[^>]*>([^<]+)<\/time>/i.exec(m[2])?.[1];
    if (!href || !title || !date || /<a\b/i.test(m[2])) fail('parser-drift');
    const u = new URL(decode(href),source.endpoint);
    if (u.origin !== 'https://www.anthropic.com' || !/^\/news\/[a-z0-9-]+$/.test(u.pathname) || u.search || u.hash) fail('html-url-policy');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const d = /^([A-Z][a-z]{2}) ([0-9]{1,2}), ([0-9]{4})$/.exec(clean(date)); if (!d || !months.includes(d[1])) fail('parser-drift');
    const published = sourceTime(`${d[3]}-${String(months.indexOf(d[1])+1).padStart(2,'0')}-${d[2].padStart(2,'0')}`);
    if (seen.has(u.href)) fail('html-duplicate'); seen.add(u.href);
    const normalizedTitle = clean(title); if (!normalizedTitle) fail('parser-drift');
    records.push({sourceItemId:null,canonicalUrl:u.href,sourceUrl:href,title:normalizedTitle,published:published.at,updated:null,precision:'date',discoveredUrls:[],semantic:{url:u.href,title:normalizedTitle,published:published.at}});
  }
  return records.slice(0,source.maxItems);
}
export function observation(record, source, capturedAt, observedAt) {
  if (!validTime(capturedAt) || !validTime(observedAt) || Date.parse(observedAt) < Date.parse(capturedAt)) fail('collector-time');
  const contentDigest = digest(record.semantic);
  const locator = `${source.id}\n${record.sourceItemId || record.canonicalUrl}`;
  const observationId = digest(`observation-v1\n${locator}\n${contentDigest}`);
  const identifiers = [`url:${source.id}:${record.canonicalUrl}`];
  if (record.sourceItemId) identifiers.push(`item:${source.id}:${record.sourceItemId}`);
  return validateContract({version:1,observationId,sourceId:source.id,adapterId:source.adapter,laneHint:source.lane,channelClass:source.channelClass,sourceItemId:record.sourceItemId,canonicalUrl:record.canonicalUrl,sourceUrl:record.sourceUrl,discoveredUrls:record.discoveredUrls,contentDigest,title:record.title,sourcePublishedAt:record.published,sourceUpdatedAt:record.updated,sourceTimePrecision:record.precision,capturedAt,observedAt,identifiers,retentionClass:source.retentionClass,snapshotLocator:null,fetchStatus:'ok',policyStatus:'allowed'},'observation');
}

export const emptyState = () => ({version:1,observations:{},sourceCursors:{},seen:[]});
// Store only identity/time/channel facts, never adapter semantic text or raw response bodies.
export function compactState(state, now) {
  for (const [id, row] of Object.entries(state.observations)) {
    row.seenAt = row.seenAt.filter(at => Date.parse(at) >= now-WINDOW);
    if (!row.seenAt.length) delete state.observations[id];
    else { row.firstAt = row.seenAt[0]; row.lastAt = row.seenAt.at(-1); }
  }
  state.seen = seenRecords(state);
  return state;
}
export function updateSeen(state, observations, now) {
  compactState(state,now); let newObservationCount = 0, duplicateObservationCount = 0;
  const before = new Set(Object.values(state.observations).flatMap(x => x.identifiers));
  const newlySeenIdentifiers = new Set();
  for (const o of observations) {
    const prior = state.observations[o.observationId];
    if (prior) { if (prior.lastAt !== o.observedAt) prior.seenAt.push(o.observedAt); prior.lastAt = o.observedAt; duplicateObservationCount++; }
    else { state.observations[o.observationId] = {firstAt:o.observedAt,lastAt:o.observedAt,seenAt:[o.observedAt],identifiers:o.identifiers,channelClass:o.channelClass}; newObservationCount++; }
    o.identifiers.filter(k => !before.has(k)).forEach(k => newlySeenIdentifiers.add(k));
  }
  state.seen = seenRecords(state);
  return {newObservationCount,duplicateObservationCount,newlySeenIdentifiers:[...newlySeenIdentifiers].sort()};
}
export function seenRecords(state) {
  const result = {};
  for (const [id, row] of Object.entries(state.observations).sort(([a],[b]) => a.localeCompare(b))) for (const identifierKey of row.identifiers) {
    const s = result[identifierKey] ||= {identifierKey,firstSeenAt90d:row.firstAt,lastSeenAt:row.lastAt,uniqueObservationCount90d:0,firstObservationId90d:id,channelClasses:[]};
    if (row.firstAt < s.firstSeenAt90d || row.firstAt === s.firstSeenAt90d && id < s.firstObservationId90d) { s.firstSeenAt90d = row.firstAt; s.firstObservationId90d = id; }
    if (row.lastAt > s.lastSeenAt) s.lastSeenAt = row.lastAt;
    s.uniqueObservationCount90d++; if (!s.channelClasses.includes(row.channelClass)) s.channelClasses.push(row.channelClass);
  }
  return Object.values(result).sort((a,b) => a.identifierKey.localeCompare(b.identifierKey)).map(x => ({...x,channelClasses:x.channelClasses.sort()}));
}
export function validateState(state, now) {
  validateContract(state,'state');
  keys(state,['version','observations','sourceCursors','seen']);
  if (state.version !== 1 || !state.observations || !state.sourceCursors || Array.isArray(state.observations) || Array.isArray(state.sourceCursors)) fail('state-shape');
  for (const [id,row] of Object.entries(state.observations)) {
    keys(row,['firstAt','lastAt','seenAt','identifiers','channelClass']);
    if (!hashPattern.test(id) || !validTime(row.firstAt) || !validTime(row.lastAt) || Date.parse(row.firstAt) > Date.parse(row.lastAt) || Date.parse(row.lastAt) > now || !['aggregator','authority-local','publisher'].includes(row.channelClass) || !Array.isArray(row.identifiers) || !row.identifiers.length || row.identifiers.length > 2 || new Set(row.identifiers).size !== row.identifiers.length) fail('state-row');
    for (const k of row.identifiers) if (typeof k !== 'string' || k.length > 4096 || !/^(?:url|item):(?:hn-new|kagoshima-new|anthropic-news):/.test(k)) fail('state-identifier');
    if (!Array.isArray(row.seenAt) || !row.seenAt.length || row.seenAt[0] !== row.firstAt || row.seenAt.at(-1) !== row.lastAt || row.seenAt.some((at,i) => !validTime(at) || iso(at) !== at || Date.parse(at) > now || i && Date.parse(at) <= Date.parse(row.seenAt[i-1]))) fail('state-seen-times');
  }
  for (const [id,at] of Object.entries(state.sourceCursors)) if (!['hn-new','kagoshima-new','anthropic-news'].includes(id) || !validTime(at) || Date.parse(at) > now) fail('state-cursor');
  if (!Array.isArray(state.seen) || canonical(state.seen) !== canonical(seenRecords(state))) fail('seen-ledger-mismatch');
  return state;
}
export function validateCandidate(manifest, stateBytes, candidate, compatibility, now) {
  validateContract(manifest,'manifest');
  keys(manifest,['version','kind','repository','workflow','branch','producer','startedAt','completedAt','githubRetentionDays','retentionCapability','contractDigest','sourceConfigDigest','previousStateDigest','stateDigest','payloadDigest','stateEncoding','manifestDigest','imported','coldStart','health']);
  const {manifestDigest, ...unsigned} = manifest;
  if (manifestDigest !== digest(unsigned)) fail('manifest-digest');
  const run = candidate.run;
  if (manifest.version !== 1 || manifest.kind !== candidate.kind || manifest.repository !== REPOSITORY || manifest.workflow !== WORKFLOW || manifest.branch !== 'main' || run.repository?.full_name !== REPOSITORY || run.path !== WORKFLOW || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success') fail('provenance');
  keys(manifest.producer,['runId','attempt','headSha']);
  if (manifest.producer.runId !== String(run.id) || manifest.producer.attempt !== run.run_attempt || manifest.producer.headSha !== run.head_sha || candidate.runId !== String(run.id) || candidate.attempt !== run.run_attempt || !/^[a-f0-9]{40}$/.test(run.head_sha)) fail('run-binding');
  if (!validTime(manifest.startedAt) || !validTime(manifest.completedAt) || Date.parse(manifest.completedAt) > now || Date.parse(manifest.startedAt) > Date.parse(manifest.completedAt)) fail('manifest-time');
  if (manifest.contractDigest !== compatibility.contractDigest || manifest.sourceConfigDigest !== compatibility.sourceConfigDigest) fail('compatibility');
  if (manifest.payloadDigest !== digest(stateBytes)) fail('payload-digest');
  let state; try { state = JSON.parse(brotliDecompressSync(stateBytes,{maxOutputLength:8*1024*1024}).toString('utf8')); } catch { fail('state-decode'); }
  if (manifest.stateDigest !== digest(state)) fail('state-digest');
  return validateState(state,now);
}
export function recoverState(candidates, compatibility, now) {
  const failures = [];
  for (const kind of ['rolling','checkpoint']) {
    const c = candidates[kind]; if (!c) continue;
    try {
      if (c.downloadFailed) fail('download-failed');
      const state = validateCandidate(c.manifest,c.stateBytes,c,compatibility,now);
      return {state,imported:{artifactId:c.artifactId,runId:c.runId,attempt:c.attempt,kind,stateDigest:c.manifest.stateDigest},seenState:kind === 'rolling' ? 'ok' : 'recovered-gap',failures};
    } catch(e) { failures.push({kind,code:safeCode(e)}); }
  }
  return {state:emptyState(),imported:null,seenState:'cold-start',failures};
}
const safeCode = e => /^[a-z][a-z0-9-]{0,80}$/.test(e.message) ? e.message : 'adapter-error';

export async function capture(config, recovery, {fetchBody, stats, clock = () => new Date()} ) {
  const state = structuredClone(recovery.state), health = [], observations = [];
  for (const source of config.sources) {
    const start = iso(clock()), cursor = state.sourceCursors[source.id];
    if (cursor && Date.parse(start)-Date.parse(cursor) < source.cadenceSeconds * 1000) { health.push({sourceId:source.id,status:'skipped-not-due',itemCount:0,classifications:{},requests:0}); continue; }
    const requestStart = stats.requests; const classifications = {};
    try {
      let rows = [];
      const r = await fetchBody(source.endpoint,source);
      if (source.id === 'hn-new') {
        let ids; try { ids = JSON.parse(r.body); } catch { fail('json-malformed'); }
        if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) fail('hn-list-shape');
        for (const id of ids.slice(0,source.maxItems)) {
          const item = await fetchBody(`https://hacker-news.firebaseio.com/v0/item/${id}.json`,source);
          let parsed; try { parsed = JSON.parse(item.body); } catch { fail('json-malformed'); }
          const h = hnRecord(parsed,id); classifications[h.status] = (classifications[h.status] || 0) + 1;
          if (h.status === 'ok') rows.push(observation(h.record,source,item.capturedAt,iso(clock())));
        }
      } else {
        const records = source.id === 'kagoshima-new' ? feedRecords(r.body,source,() => { classifications['needs-review'] = (classifications['needs-review'] || 0)+1; }) : htmlRecords(r.body,source);
        rows = records.map(record => observation(record,source,r.capturedAt,iso(clock())));
      }
      observations.push(...rows); state.sourceCursors[source.id] = start;
      health.push({sourceId:source.id,status:classifications['needs-review'] ? 'error' : rows.length ? 'ok' : 'empty',...(classifications['needs-review'] ? {code:'https-equivalence-needs-review'} : {}),itemCount:rows.length,classifications,requests:stats.requests-requestStart});
    } catch(e) { health.push({sourceId:source.id,status:'error',code:safeCode(e),itemCount:0,classifications,requests:stats.requests-requestStart}); }
  }
  const counts = updateSeen(state,observations,Date.parse(iso(clock())));
  return {state,observations,sourceHealth:health,...counts,perLaneCounts:Object.fromEntries(['watch','discover','sentinel'].map(l => [l,observations.filter(o => o.laneHint === l).length])),publicationAuthorized:false};
}

export function jstDate(at) { return new Date(Date.parse(at)+9*3600000).toISOString().slice(0,10); }
export function scheduledSlot(createdAt, event) {
  if (event !== 'schedule') return null;
  const at = new Date(createdAt); at.setUTCMinutes(17,0,0); if (at.getTime() > Date.parse(createdAt)) at.setUTCHours(at.getUTCHours()-1); return at.toISOString();
}
function parseArtifact(a, kind) {
  const re = kind === 'rolling' ? /^radar-shadow-([1-9][0-9]*)-([1-9][0-9]*)$/ : /^radar-daily-checkpoint-(\d{4}-\d{2}-\d{2})-([1-9][0-9]*)-([1-9][0-9]*)$/;
  const m = re.exec(a.name); if (!m || a.expired) return null;
  const runId = m[kind === 'rolling' ? 1 : 2];
  if (String(a.workflow_run?.id) !== runId) return null;
  return {kind,artifactId:a.id,name:a.name,createdAt:a.created_at,runId,attempt:Number(m[kind === 'rolling' ? 2 : 3]),date:kind === 'checkpoint' ? m[1] : null};
}
const artifactOrder = (a,b) => b.createdAt.localeCompare(a.createdAt) || (BigInt(a.runId) > BigInt(b.runId) ? -1 : BigInt(a.runId) < BigInt(b.runId) ? 1 : b.attempt-a.attempt) || b.artifactId-a.artifactId;
const runSnapshot = r => ({id:r.id,run_attempt:r.run_attempt,head_sha:r.head_sha,head_branch:r.head_branch,path:r.path,repository:{full_name:r.repository?.full_name},created_at:r.created_at,run_started_at:r.run_started_at || r.created_at,status:r.status,conclusion:r.conclusion,event:r.event});
export async function planRecovery(api, current, {maxPages = 30, targetDate = jstDate(current.run_started_at || current.created_at)} = {}) {
  const priorResponse = await api(`/actions/workflows/discovery-radar-shadow.yml/runs?branch=main&status=success&per_page=100`);
  if (!Array.isArray(priorResponse.workflow_runs)) fail('actions-runs-unavailable');
  const prior = priorResponse.workflow_runs.filter(r => String(r.id) !== String(current.id) && Date.parse(r.created_at) < Date.parse(current.created_at)).sort((a,b) => b.created_at.localeCompare(a.created_at) || b.id-a.id)[0];
  let rolling = null;
  const acceptableRun = r => r.path === WORKFLOW && r.repository?.full_name === REPOSITORY && r.head_branch === 'main' && r.status === 'completed' && r.conclusion === 'success' && String(r.id) !== String(current.id) && Date.parse(r.created_at) < Date.parse(current.created_at);
  if (prior) {
    if (!acceptableRun(prior)) fail('actions-run-provenance');
    const list = await api(`/actions/runs/${prior.id}/artifacts?per_page=100`); if (!Array.isArray(list.artifacts) || list.total_count > 100) fail('actions-artifacts-unavailable');
    rolling = list.artifacts.map(a => parseArtifact(a,'rolling')).filter(c => c && c.runId === String(prior.id) && c.attempt === prior.run_attempt).sort(artifactOrder)[0] || null;
    if (rolling) rolling.run = runSnapshot(prior);
  }
  const checkpoints = []; let complete = false;
  for (let page = 1; page <= maxPages; page++) {
    const list = await api(`/actions/artifacts?per_page=100&page=${page}`); if (!Array.isArray(list.artifacts)) fail('actions-artifacts-unavailable');
    checkpoints.push(...list.artifacts.map(a => parseArtifact(a,'checkpoint')).filter(Boolean));
    if (list.artifacts.length < 100 || list.artifacts.every(a => Date.parse(a.created_at) < Date.parse(current.created_at)-91*86400000)) { complete = true; break; }
  }
  if (!complete) fail('actions-scan-bound');
  let checkpoint = null, existingCheckpoint = false, checks = 0;
  for (const c of checkpoints.sort(artifactOrder)) {
    if (c.runId === String(current.id)) continue;
    if (++checks > 100) fail('checkpoint-scan-bound');
    const run = await api(`/actions/runs/${c.runId}`);
    if (!acceptableRun(run) || run.run_attempt !== c.attempt) continue;
    c.run = runSnapshot(run);
    if (c.date === targetDate) existingCheckpoint = true;
    if (!checkpoint) checkpoint = c;
    // Older artifacts cannot be today's first successful checkpoint or a newer fallback.
    if (checkpoint && (existingCheckpoint || c.date < targetDate)) break;
  }
  return {current:runSnapshot(current),rolling,checkpoint,existingCheckpoint,targetDate};
}
export async function githubReader(token) {
  if (!token) fail('actions-token-required'); let requests = 0;
  return {stats:() => requests, get:async route => {
    if (!/^\/actions\/[a-zA-Z0-9?&=./_-]+$/.test(route)) fail('api-route'); requests++;
    const addresses = await dns.lookup('api.github.com',{all:true}); if (!addresses.length || addresses.some(a => !publicAddress(a.address))) fail('api-dns-policy');
    const r = await pinnedRequest(`https://api.github.com/repos/${REPOSITORY}${route}`,{addresses,timeoutMs:10000,maxBytes:4*1024*1024,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'JAMIO-Discovery-Shadow/0A'}});
    if (r.status !== 200) fail('actions-api-error'); try { return JSON.parse(r.body.toString('utf8')); } catch { fail('actions-api-json'); }
  }};
}
export function outputBase(env) {
  if (!env.RUNNER_TEMP) fail('runner-temp-required');
  const temp = fs.realpathSync(env.RUNNER_TEMP), base = path.join(temp,'discovery-radar');
  if (temp === root || temp.startsWith(root+path.sep)) fail('output-in-repository');
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) fail('output-symlink');
  fs.mkdirSync(base,{recursive:true}); return base;
}
function writeJson(file,value) { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,canonical(value)+'\n',{flag:'wx'}); }
export function payloadBytes(files, budget) { const bytes = Object.values(files).reduce((n,b) => n+Buffer.byteLength(b),0); if (bytes > budget) fail('artifact-budget'); return bytes; }
export function packageCapture(result, recovery, plan, binding, compatibility, githubRetentionDays) {
  const capability = githubRetentionDays >= 90 ? 'ok' : 'degraded';
  const stateBytes = brotliCompressSync(Buffer.from(canonical(result.state)+'\n'),{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:5}});
  const health = recovery.seenState !== 'ok' || recovery.failures.length || result.sourceHealth.some(x => x.status === 'error') ? 'degraded' : 'ok';
  const common = {version:1,repository:REPOSITORY,workflow:WORKFLOW,branch:'main',producer:{runId:String(binding.id),attempt:binding.run_attempt,headSha:binding.head_sha},startedAt:binding.startedAt,completedAt:binding.completedAt,githubRetentionDays,retentionCapability:capability,...compatibility,previousStateDigest:recovery.imported?.stateDigest || null,stateDigest:digest(result.state),payloadDigest:digest(stateBytes),stateEncoding:'brotli-canonical-json-v1',imported:recovery.imported,coldStart:!recovery.imported,health};
  const manifest = kind => { const m = {...common,kind}; return validateContract({...m,manifestDigest:digest(m)},'manifest'); };
  const slot = scheduledSlot(binding.created_at,binding.event);
  const checkpointDate = jstDate(binding.completedAt);
  const existingCheckpoint = plan.targetDate && plan.targetDate !== checkpointDate ? false : plan.existingCheckpoint;
  const report = {version:1,publicationAuthorized:false,run:{runId:String(binding.id),attempt:binding.run_attempt,headSha:binding.head_sha,startedAt:binding.startedAt,completedAt:binding.completedAt,runCreatedAt:binding.created_at,event:binding.event,scheduledSlotAt:slot,scheduleDelaySeconds:slot ? Math.max(0,(Date.parse(binding.startedAt)-Date.parse(slot))/1000) : null,scheduleDelayMethod:slot ? 'latest-hourly-17-slot-before-run-creation' : 'not-scheduled'},health,seenState:recovery.seenState,importedState:recovery.imported,sourceHealth:result.sourceHealth,newObservationCount:result.newObservationCount,duplicateObservationCount:result.duplicateObservationCount,perLaneCounts:result.perLaneCounts,newlySeenIdentifiers:result.newlySeenIdentifiers,failures:recovery.failures,artifactBytes:{rolling:0,checkpoint:0},requestCounts:{actions:plan.apiRequests || 0,sources:binding.sourceRequests},responseBytes:binding.responseBytes,githubRetentionDays,retentionCapability:capability,checkpoint:{date:checkpointDate,existingSuccessful:existingCheckpoint,uploadPlanned:!existingCheckpoint,retentionDays:Math.min(90,githubRetentionDays)},rawSourceBodyPersistedBytes:0};
  const json = v => canonical(v)+'\n';
  const checkpoint = {'manifest.json':json(manifest('checkpoint')),'state/seen.json.br':stateBytes};
  report.artifactBytes.checkpoint = payloadBytes(checkpoint,CHECKPOINT_BUDGET);
  const rolling = {'manifest.json':json(manifest('rolling')),'state/seen.json.br':stateBytes,'capture/observations.jsonl':result.observations.map(json).join(''),'capture/source-health.json':json(result.sourceHealth),'capture-report.json':''};
  // The report counts its own bytes; settle the decimal length before enforcing the hard cap.
  for (let i = 0; i < 5; i++) { rolling['capture-report.json'] = json(report); report.artifactBytes.rolling = payloadBytes(rolling,ROLLING_BUDGET); }
  rolling['capture-report.json'] = json(report); if (payloadBytes(rolling,ROLLING_BUDGET) !== report.artifactBytes.rolling) fail('artifact-size-accounting');
  validateContract(report,'report'); validateState(result.state,Date.parse(binding.completedAt));
  return {rolling,checkpoint,report};
}
function savePayload(directory,files) {
  if (fs.existsSync(directory)) fail('output-already-exists');
  for (const [name,bytes] of Object.entries(files)) { const file = path.join(directory,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,bytes,{flag:'wx'}); }
}
async function main(command,env = process.env) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== 'refs/heads/main') fail('main-only');
  const base = outputBase(env);
  if (command === 'plan' || command === 'checkpoint-check') {
    const api = await githubReader(env.GITHUB_TOKEN);
    const current = await api.get(`/actions/runs/${env.GITHUB_RUN_ID}`);
    if (current.path !== WORKFLOW || current.repository?.full_name !== REPOSITORY || current.head_branch !== 'main' || current.head_sha !== env.GITHUB_SHA || current.run_attempt !== Number(env.GITHUB_RUN_ATTEMPT)) fail('current-run-binding');
    const targetDate = env.CHECKPOINT_DATE || jstDate(iso(new Date()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) fail('checkpoint-date');
    const plan = await planRecovery(api.get,current,{targetDate}); plan.apiRequests = api.stats();
    if (command === 'plan') {
      writeJson(path.join(base,'plan.json'),plan);
      if (env.GITHUB_OUTPUT) for (const kind of ['rolling','checkpoint']) if (plan[kind]) fs.appendFileSync(env.GITHUB_OUTPUT,`${kind}-run=${plan[kind].runId}\n${kind}-id=${plan[kind].artifactId}\n`);
    } else {
      if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT,`upload=${!plan.existingCheckpoint}\n`);
      console.log(canonical({checkpointDate:targetDate,existingSuccessful:plan.existingCheckpoint,checkpointCheckActionsRequests:api.stats(),publicationAuthorized:false}));
    }
    return;
  }
  if (command !== 'capture') fail('unknown-command');
  const plan = JSON.parse(fs.readFileSync(path.join(base,'plan.json'),'utf8'));
  const config = validateSourceConfig(JSON.parse(fs.readFileSync(path.join(root,'config/discovery-radar-sources.json'),'utf8')));
  const contract = JSON.parse(fs.readFileSync(path.join(root,'contracts/discovery-radar.schema.json'),'utf8'));
  const compatibility = {contractDigest:digest(contract),sourceConfigDigest:digest(config)};
  const candidates = {};
  for (const kind of ['rolling','checkpoint']) if (plan[kind]) {
    try {
      const dir = path.join(base,'prior-'+kind);
      const manifestPath = path.join(dir,'manifest.json'), statePath = path.join(dir,'state/seen.json.br');
      for (const p of [dir,path.join(dir,'state'),manifestPath,statePath]) if (fs.lstatSync(p).isSymbolicLink()) fail('import-symlink');
      if (fs.statSync(manifestPath).size > 16384 || fs.statSync(statePath).size > CHECKPOINT_BUDGET) fail('import-size');
      candidates[kind] = {...plan[kind],manifest:JSON.parse(fs.readFileSync(manifestPath,'utf8')),stateBytes:fs.readFileSync(statePath)};
    } catch { candidates[kind] = {...plan[kind],downloadFailed:true}; }
  }
  const startedAt = iso(new Date());
  const recovery = recoverState(candidates,compatibility,Date.parse(startedAt));
  const fetcher = createSourceFetcher();
  const result = await capture(config,recovery,fetcher);
  const githubRetentionDays = Number(env.GITHUB_RETENTION_DAYS);
  if (!Number.isInteger(githubRetentionDays) || githubRetentionDays < 1 || githubRetentionDays > 90) fail('retention-unavailable');
  const binding = {...plan.current,startedAt,completedAt:iso(new Date()),sourceRequests:fetcher.stats.requests,responseBytes:fetcher.stats.bytes};
  const output = packageCapture(result,recovery,plan,binding,compatibility,githubRetentionDays);
  savePayload(path.join(base,'rolling'),output.rolling);
  if (output.report.checkpoint.uploadPlanned) savePayload(path.join(base,'checkpoint'),output.checkpoint);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT,`checkpoint-date=${output.report.checkpoint.date}\ncheckpoint-retention=${output.report.checkpoint.retentionDays}\ncheckpoint-planned=${output.report.checkpoint.uploadPlanned}\n`);
  console.log(canonical({publicationAuthorized:false,health:output.report.health,seenState:recovery.seenState,sourceStatuses:result.sourceHealth.map(x => ({sourceId:x.sourceId,status:x.status,code:x.code || null})),artifactBytes:output.report.artifactBytes,requests:output.report.requestCounts}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2]).catch(e => { console.error(safeCode(e)); process.exitCode = 1; });
