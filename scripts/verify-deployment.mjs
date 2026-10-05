import path from 'node:path';
import {editionIdentity, newestEdition, receiptIdentityMatches} from './edition.mjs';
import {fileURLToPath} from 'node:url';
import {loadRepository, editionDigest, editionURL} from './production.mjs';
import {assertPublicReceipt} from './remote-proof.mjs';

export async function verifyDeployment(root, commit, {request = fetch} = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Deployment verification requires the exact main SHA');
  const {config, articles, editions, prices} = loadRepository(root);
  const get = async url => {
    const response = await request(url, {cache: 'no-store', signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`Public receipt HTTP ${response.status}`);
    return response;
  };
  const manifest = await (await get(new URL(`publication.json?commit=${commit}`, config.url).href)).json();
  if (manifest.contractVersion !== 1 || manifest.commit !== commit || manifest.editions?.length !== editions.length) throw new Error('Public deployment receipt is stale or incomplete');
  for (const edition of editions) {
    const matches = manifest.editions.filter(e => receiptIdentityMatches(e, editionIdentity(edition.slug)));
    const item = matches.length === 1 ? matches[0] : null;
    if (item?.url !== editionURL(config, edition.slug) || item?.digest !== editionDigest(edition, articles, prices)) throw new Error('Public edition receipt does not match this deployed main');
  }
  const latest = editions.slice().sort(newestEdition)[0];
  const editionUrl = editionURL(config, latest.slug), digest = editionDigest(latest, articles, prices);
  const html = await (await get(`${editionUrl}?commit=${commit}`)).text();
  assertPublicReceipt(manifest, {commit, ...editionIdentity(latest.slug), editionUrl, digest}, html);
  return {status: 'receipt-verified', contractVersion: 1, commit, editions: manifest.editions, verifiedEdition: {...editionIdentity(latest.slug), url: editionUrl, digest}};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let failure;
  const deadline = Date.now() + 600000;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const result = await verifyDeployment(root, process.env.GITHUB_SHA);
      console.log('JAMIO_PUBLIC_RECEIPT ' + JSON.stringify(result));
      failure = null;
      break;
    } catch (error) {
      failure = error;
      if (Date.now() >= deadline) break;
      if (attempt < 19) await new Promise(resolve => setTimeout(resolve, Math.min(30000, deadline - Date.now())));
    }
  }
  if (failure) { console.error(JSON.stringify({status: 'failed', error: failure.message})); process.exitCode = 1; }
}
