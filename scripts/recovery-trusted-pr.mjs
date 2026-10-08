import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {previewPackage, MAX_PACKET_BYTES} from './recovery-preview.mjs';
import {createOfflineReview} from './recovery-offline-review.mjs';

const SHA = /^[a-f0-9]{40}$/;
const EDITION = /^\d{4}-\d{2}-\d{2}-(morning|evening)$/;
const REPO = 'hm2236/jamio-news';
const git = (root, args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024
}).trim();

function identity(event, root) {
  const pr = event?.pull_request;
  if (event?.repository?.full_name !== REPO ||
      !Number.isSafeInteger(pr?.number) || pr.number < 1 ||
      pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== REPO ||
      pr.head?.repo?.full_name !== REPO ||
      !pr.head?.ref?.startsWith('recovery/') ||
      !SHA.test(pr.base?.sha || '') || !SHA.test(pr.head?.sha || '') ||
      pr.base.sha === pr.head.sha || pr.state !== 'open') {
    throw new Error('Trusted preview requires an open, same-repository recovery PR into main');
  }
  if (git(root, ['rev-parse', 'HEAD']) !== pr.base.sha) {
    throw new Error('Trusted source checkout SHA is not exact PR base');
  }
  return {baseSha: pr.base.sha, headSha: pr.head.sha, number: pr.number};
}

// An untrusted PR can contribute exactly one NEW JSON data file. All code and
// workflow commands must come from trusted main, never from that PR checkout.
export function validateTrustedPacketCommit(root, event) {
  const ids = identity(event, root);
  const commits = git(root, ['rev-list', '--reverse', ids.baseSha + '..' + ids.headSha])
    .split('\n').filter(Boolean);
  if (commits.length !== 1 || commits[0] !== ids.headSha ||
      git(root, ['show', '-s', '--format=%P', ids.headSha]) !== ids.baseSha) {
    throw new Error('Trusted preview requires exactly one add-only commit from current main');
  }
  const fields = git(root, ['diff', '--no-renames', '--name-status', '-z',
    ids.baseSha, ids.headSha]).split('\0').filter(Boolean);
  if (fields.length !== 2 || fields[0] !== 'A') {
    throw new Error('Trusted preview PR may add only one packet file');
  }
  const file = fields[1];
  if (!/^recovery-packets\/\d{4}-\d{2}-\d{2}-(morning|evening)\.json$/.test(file)) {
    throw new Error('Trusted preview PR includes forbidden or missing file');
  }
  const ls = git(root, ['ls-tree', ids.headSha, '--', file]);
  if (!/^100644 blob [a-f0-9]{40}\t/.test(ls) || !ls.endsWith('\t' + file)) {
    throw new Error('Trusted preview packet must be a regular file, not a link');
  }
  const raw = execFileSync('git', ['show', ids.headSha + ':' + file], {
    cwd: root, timeout: 30000, maxBuffer: MAX_PACKET_BYTES + 8192
  });
  if (raw.length > MAX_PACKET_BYTES) throw new Error('Trusted preview packet exceeds 1 MiB');
  const packet = JSON.parse(raw.toString('utf8'));
  const slug = file.slice('recovery-packets/'.length, -'.json'.length);
  if (!EDITION.test(slug) || packet?.baseSha !== ids.baseSha ||
      packet?.package?.edition?.slug !== slug) {
    throw new Error('Trusted preview packet identity/base mismatch');
  }
  return {...ids, slug, file, packet, packetSha256: createHash('sha256').update(raw).digest('hex')};
}
async function fetchJSON(request, suffix, allow404 = false) {
  const url = 'https://api.github.com/repos/' + REPO + suffix;
  const response = await request(url, {redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: {'Accept':'application/vnd.github+json', 'User-Agent':'jamio-news-trusted-preview'}});
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error('Trusted live GitHub API check unavailable');
  return response.json();
}
export async function trustedPreview(root, event, output, {request = fetch, now = () => new Date()} = {}) {
  root = fs.realpathSync(root);
  const ids = validateTrustedPacketCommit(root, event);
  // A cached event is not an authorization: recheck *live* ref + same PR identity.
  async function fence() {
    const main = await fetchJSON(request, '/git/ref/heads/main');
    if (main?.object?.sha !== ids.baseSha) throw new Error('Main changed after preview event');
    const pr = await fetchJSON(request, '/pulls/' + ids.number);
    if (pr?.state !== 'open' || pr?.head?.sha !== ids.headSha ||
        pr?.base?.sha !== ids.baseSha || pr?.head?.repo?.full_name !== REPO) {
      throw new Error('Recovery PR identity changed after preview event');
    }
    if (await fetchJSON(request, '/git/ref/heads/daily/' + ids.slug, true)) {
      throw new Error('Another daily branch already exists');
    }
    const all = await fetchJSON(request, '/pulls?state=open&head=hm2236:daily/' + ids.slug + '&per_page=100');
    if (!Array.isArray(all) || all.length !== 0) throw new Error('Another daily PR already exists');
  }
  await fence();
  let created = false;
  try {
    const receipt = previewPackage(root, ids.packet, output, {expectedBaseSha: ids.baseSha, now});
    created = true;
    const offline = createOfflineReview(output);
    await fence();
    const result = {status:'trusted-preview-ready', source:'trusted-main-pull-request-target',
      baseSha: ids.baseSha, headSha: ids.headSha, pr: ids.number,
      slug: ids.slug, digest: receipt.digest, packetSha256: ids.packetSha256,
      offlineSha256: offline.sha256,
      publicationAuthorized:false, editorialReviewRequired:true};
    fs.writeFileSync(path.join(output,'trusted-preview.json'),
      JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
    return result;
  } catch (error) {
    if (created && fs.existsSync(output)) fs.rmSync(output,{recursive:true,force:true});
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [output, ...rest] = process.argv.slice(2);
    if (!output || rest.length || !process.env.GITHUB_EVENT_PATH) {
      throw new Error('Trusted PR event and one output path required');
    }
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
    const root = process.cwd();
    // Fetch only exact commit objects, without checking out or executing PR files.
    const ids = identity(event, root);
    git(root,['fetch','origin','main']);
    if (git(root,['rev-parse','origin/main']) !== ids.baseSha) {
      throw new Error('Current main SHA has advanced');
    }
    git(root,['fetch','origin',ids.headSha]);
    console.log('JAMIO_TRUSTED_PREVIEW ' +
      JSON.stringify(await trustedPreview(root,event,output)));
  } catch {
    // Never print the untrusted JSON payload, credentials or arbitrary paths.
    console.error(JSON.stringify({status:'failed',publicationAuthorized:false,
      error:'Trusted preview rejected: inspect current main/PR/diff/JST/source evidence'}));
    process.exitCode = 1;
  }
}
