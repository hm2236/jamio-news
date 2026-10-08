import {createHash} from 'node:crypto';

const fail = code => { throw new Error(code); };
export const WINDOW = 90 * 86400000;
export const STATE_ENCODING = 'brotli-canonical-json-v1';
export const CONFIG_SNAPSHOT_BUDGET = 12 * 1024;
export const LEGACY_CONTRACT_DIGEST = 'sha256:761f3793048b7e1beaf399e95d563ecc3f79a8d6be04380470a7e99ebed5f579';
export const LEGACY_CONFIG_DIGEST = 'sha256:533859b3f465ce3cd3e58d3719ff266ea773cbd634ae9985839132cd42a137e1';
export const LEGACY_STATE_POLICY_DIGEST = 'sha256:d1b5a21def0c02116069883b8bbe02c6a1d05646a7a71284dff608474c3921b5';
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) fail('invalid-canonical-value');
  return JSON.stringify(value);
}
export const digest = value => 'sha256:' + createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
// Audited main 137552438046ac6543c3a8e5bf164973f5f2baaf. Never load this from mutable runtime config.
export const LEGACY_SOURCE_CONFIG = freeze({
  "version": 1,
  "sources": [
    {
      "id": "hn-new",
      "adapter": "hn-item-v1",
      "lane": "discover",
      "channelClass": "aggregator",
      "cadenceSeconds": 3600,
      "maxItems": 1,
      "endpoint": "https://hacker-news.firebaseio.com/v0/newstories.json",
      "maxBytes": 262144,
      "contentTypes": [
        "application/json"
      ],
      "retentionClass": "metadata-90d"
    },
    {
      "id": "kagoshima-new",
      "adapter": "kagoshima-feed-v1",
      "lane": "sentinel",
      "channelClass": "authority-local",
      "cadenceSeconds": 3600,
      "maxItems": 20,
      "endpoint": "https://www.pref.kagoshima.jp/saishin/saishin.xml",
      "maxBytes": 262144,
      "contentTypes": [
        "text/xml",
        "application/xml",
        "application/rss+xml",
        "application/atom+xml",
        "application/rdf+xml"
      ],
      "retentionClass": "metadata-90d",
      "httpsEquivalence": [
        {
          "httpsUrl": "https://www.pref.kagoshima.jp/ae06/kenko-fukushi/kenko-iryo/kenko/kagoshima21/yellowcard/kyoukagekkann.html",
          "sourceUrl": "http://www.pref.kagoshima.jp/ae06/kenko-fukushi/kenko-iryo/kenko/kagoshima21/yellowcard/kyoukagekkann.html",
          "verifiedAt": "2026-10-06T13:48:43.6711019Z",
          "httpsStatus": 200,
          "method": "visible-text-and-canonical-url",
          "httpStatus": 200,
          "normalizedTextDigest": "sha256:c79c9f4537dd583228a5b4e796ec2e18f438f98484dafb80ff45734887f8d542"
        },
        {
          "httpsUrl": "https://www.pref.kagoshima.jp/ae06/kenko-fukushi/kenko-iryo/kenko/kagoshima21/yellowcard/kyosan-kikaku-waribiki-tokuten2.html",
          "sourceUrl": "http://www.pref.kagoshima.jp/ae06/kenko-fukushi/kenko-iryo/kenko/kagoshima21/yellowcard/kyosan-kikaku-waribiki-tokuten2.html",
          "verifiedAt": "2026-10-06T13:48:43.8597263Z",
          "httpsStatus": 200,
          "method": "visible-text-and-canonical-url",
          "httpStatus": 200,
          "normalizedTextDigest": "sha256:9609ee253b2cf60777332435535468530e394f911bc067ca6467176f41bc3659"
        },
        {
          "httpsUrl": "https://www.pref.kagoshima.jp/aj01/bosai/kikikanri/torikumi/kikikannri/os26_nippou.html",
          "sourceUrl": "http://www.pref.kagoshima.jp/aj01/bosai/kikikanri/torikumi/kikikannri/os26_nippou.html",
          "verifiedAt": "2026-10-06T13:48:44.5577140Z",
          "httpsStatus": 200,
          "method": "visible-text-and-canonical-url",
          "httpStatus": 200,
          "normalizedTextDigest": "sha256:c75575a62f8448413751111c3c8f98418924d731bc696957c02a60a8b12d87f8"
        },
        {
          "httpsUrl": "https://www.pref.kagoshima.jp/kyoiku-bunka/school/edu_infotec/jyoho/index.html",
          "sourceUrl": "http://www.pref.kagoshima.jp/kyoiku-bunka/school/edu_infotec/jyoho/index.html",
          "verifiedAt": "2026-10-06T13:48:45.3029998Z",
          "httpsStatus": 200,
          "method": "visible-text-and-canonical-url",
          "httpStatus": 200,
          "normalizedTextDigest": "sha256:6a63a04e0fc1fb0eed03c188f778f6bf1cdcf02e75529c6b02ab88452470268b"
        },
        {
          "httpsUrl": "https://www.pref.kagoshima.jp/an12/shiitakeryouri.html",
          "sourceUrl": "http://www.pref.kagoshima.jp/an12/shiitakeryouri.html",
          "verifiedAt": "2026-10-06T13:48:45.5310441Z",
          "httpsStatus": 200,
          "method": "visible-text-and-canonical-url",
          "httpStatus": 200,
          "normalizedTextDigest": "sha256:a49556672f4673ec58f74f8409522f2e336e04a5aa3f9ff8625688c7a4d6d669"
        },
        {
          "httpsUrl": "https://www.pref.kagoshima.jp/ae07/kenko-fukushi/syogai-syakai/ziritushien/oshirase/kakutan27.html",
          "sourceUrl": "http://www.pref.kagoshima.jp/ae07/kenko-fukushi/syogai-syakai/ziritushien/oshirase/kakutan27.html",
          "verifiedAt": "2026-10-06T13:48:45.9462673Z",
          "httpsStatus": 200,
          "method": "visible-text-and-canonical-url",
          "httpStatus": 200,
          "normalizedTextDigest": "sha256:97c1384a672bd84c0c5a262d8f3b337aadc997baf4b670e6d481d0e8b451f8da"
        },
        {
          "httpsUrl": "https://www.pref.kagoshima.jp/aj03/rinnyakasai.html",
          "sourceUrl": "http://www.pref.kagoshima.jp/aj03/rinnyakasai.html",
          "verifiedAt": "2026-10-06T13:48:46.1393755Z",
          "httpsStatus": 200,
          "method": "visible-text-and-canonical-url",
          "httpStatus": 200,
          "normalizedTextDigest": "sha256:953b9db0ed534ef7de8f028188662719877138d5023023e2241fe1031ced3a9e"
        },
        {
          "httpsUrl": "https://www.pref.kagoshima.jp/ab15/minnakaigi-r8tarumizu.html",
          "sourceUrl": "http://www.pref.kagoshima.jp/ab15/minnakaigi-r8tarumizu.html",
          "verifiedAt": "2026-10-06T13:48:46.3183050Z",
          "httpsStatus": 200,
          "method": "visible-text-and-canonical-url",
          "httpStatus": 200,
          "normalizedTextDigest": "sha256:a0239cad8f4e20b2901c52e285467ff10a69e2c0c03032f247e82c9ad3c5e00c"
        },
        {
          "httpsUrl": "https://www.pref.kagoshima.jp/kensei/saiyo/index.html",
          "sourceUrl": "http://www.pref.kagoshima.jp/kensei/saiyo/index.html",
          "verifiedAt": "2026-10-06T13:48:46.5283685Z",
          "httpsStatus": 200,
          "method": "visible-text-and-canonical-url",
          "httpStatus": 200,
          "normalizedTextDigest": "sha256:2dce6e8bccad225da1e45bc6899eb2817c8d313e11290fe330032bfcb1f8e360"
        }
      ]
    },
    {
      "id": "anthropic-news",
      "adapter": "anthropic-index-v1",
      "lane": "watch",
      "channelClass": "publisher",
      "cadenceSeconds": 7200,
      "maxItems": 20,
      "endpoint": "https://www.anthropic.com/news",
      "maxBytes": 1048576,
      "contentTypes": [
        "text/html"
      ],
      "retentionClass": "metadata-90d"
    }
  ]
});
if (digest(LEGACY_SOURCE_CONFIG) !== LEGACY_CONFIG_DIGEST) fail('legacy-descriptor-integrity');

export function policyFingerprint(contract) {
  // Include referenced definitions transitively so an indirect schema change cannot escape the fingerprint.
  const schemas = {};
  const visit = name => {
    if (Object.hasOwn(schemas,name)) return;
    const value = contract.$defs?.[name]; if (!value) fail('state-policy-schema');
    schemas[name] = value;
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (node.$ref) { if (!node.$ref.startsWith('#/$defs/')) fail('state-policy-schema'); visit(node.$ref.slice(8)); }
      Object.values(node).forEach(walk);
    };
    walk(value);
  };
  ['state','seen','observation'].forEach(visit);
  return digest({schemas,encoding:STATE_ENCODING,windowMs:WINDOW,
    observationIdentityEpoch:'observation-v1-source-locator-content-digest',
    identifierEpoch:'source-qualified-url-item-v1',seenEpoch:'unique-observation-ledger-v1',
    adapterEpochs:{'hn-new':'hn-item-v1-policy-1','kagoshima-new':'kagoshima-feed-v1-policy-1','anthropic-news':'anthropic-index-v1-policy-1'}});
}
export function compatibilityMetadata(contract, sourceConfig) {
  return {contractDigest:digest(contract),sourceConfigDigest:digest(sourceConfig),statePolicyDigest:policyFingerprint(contract),sourceConfig:structuredClone(sourceConfig)};
}
export function validateEquivalence(source) {
  if (!Object.hasOwn(source,'httpsEquivalence')) return;
  const proofs = source.httpsEquivalence;
  if (source.id !== 'kagoshima-new' || !Array.isArray(proofs) || proofs.length > 20) fail('equivalence-config');
  const from = new Set(), to = new Set();
  const fields = ['sourceUrl','httpsUrl','method','httpStatus','httpsStatus','normalizedTextDigest','verifiedAt'];
  for (const proof of proofs) {
    if (!proof || typeof proof !== 'object' || Array.isArray(proof) || Object.keys(proof).length !== fields.length || fields.some(k => !Object.hasOwn(proof,k))) fail('equivalence-proof');
    let u; try { u = new URL(proof.sourceUrl); } catch { fail('equivalence-url'); }
    if (u.href !== proof.sourceUrl || u.hostname !== 'www.pref.kagoshima.jp' || u.protocol !== 'http:' || u.username || u.password || u.port || u.search || u.hash || proof.httpsUrl !== proof.sourceUrl.replace(/^http:/,'https:') || from.has(proof.sourceUrl) || to.has(proof.httpsUrl)) fail('equivalence-url');
    if (proof.method !== 'visible-text-and-canonical-url' || proof.httpStatus !== 200 || proof.httpsStatus !== 200 || !/^sha256:[a-f0-9]{64}$/.test(proof.normalizedTextDigest) || typeof proof.verifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(proof.verifiedAt) || !Number.isFinite(Date.parse(proof.verifiedAt))) fail('equivalence-proof');
    from.add(proof.sourceUrl); to.add(proof.httpsUrl);
  }
}
export function validateBindings(state) {
  const channels = {'hn-new':'aggregator','kagoshima-new':'authority-local','anthropic-news':'publisher'};
  for (const row of Object.values(state.observations)) {
    let sourceId, url, item;
    for (const identifier of row.identifiers) {
      const match = /^(url|item):(hn-new|kagoshima-new|anthropic-news):(.+)$/.exec(identifier);
      if (!match || /[\u0000-\u001f\u007f]/.test(match[3]) || sourceId && sourceId !== match[2]) fail('state-source-binding');
      sourceId = match[2];
      if (match[1] === 'url') { if (url !== undefined) fail('state-source-binding'); url = match[3]; }
      else { if (item !== undefined) fail('state-source-binding'); item = match[3]; }
    }
    if (row.channelClass !== channels[sourceId] || !url) fail('state-source-binding');
    let u; try { u = new URL(url); } catch { fail('state-url-binding'); }
    if (u.href !== url || u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) fail('state-url-binding');
    if (sourceId === 'hn-new') {
      if (!item || !/^[1-9][0-9]*$/.test(item) || !Number.isSafeInteger(Number(item)) || url !== `https://news.ycombinator.com/item?id=${item}`) fail('state-url-binding');
    } else if (sourceId === 'kagoshima-new') {
      if (u.hostname !== 'www.pref.kagoshima.jp' || u.search) fail('state-url-binding');
    } else if (u.hostname !== 'www.anthropic.com' || !/^\/news\/[a-z0-9-]+$/.test(u.pathname) || u.search || item !== undefined) fail('state-url-binding');
  }
}
export function migrateSources(state, previousConfig, currentConfig, rebuildSeen) {
  const migrations = [];
  for (let i = 0; i < currentConfig.sources.length; i++) {
    const before = previousConfig.sources[i], after = currentConfig.sources[i];
    if (canonical(before) === canonical(after)) continue;
    const {httpsEquivalence:oldProofs = [],...oldBase} = before;
    const {httpsEquivalence:newProofs = [],...newBase} = after;
    const additive = after.id === 'kagoshima-new' && canonical(oldBase) === canonical(newBase) && oldProofs.every(proof => newProofs.some(next => canonical(next) === canonical(proof))) && newProofs.length > oldProofs.length;
    if (!additive) for (const [id,row] of Object.entries(state.observations)) if (row.identifiers[0].startsWith(`url:${after.id}:`) || row.identifiers[0].startsWith(`item:${after.id}:`)) delete state.observations[id];
    delete state.sourceCursors[after.id];
    migrations.push({sourceId:after.id,action:additive ? 'preserved-ledger-cleared-cursor' : 'reset-source'});
  }
  state.seen = rebuildSeen(state);
  return migrations;
}
