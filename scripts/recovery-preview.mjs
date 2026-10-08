import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {canonical, validatePackage, serialize, loadRepository, planDraft, applyDraft, editionDigest} from './production.mjs';
import {validateDailyChange, validateFreshness} from './daily-pr.mjs';

export const MAX_PACKET_BYTES = 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digests = repo => Object.fromEntries(repo.editions.map(e => [e.slug, editionDigest(e, repo.articles, repo.prices)]));
const gitHead = root => execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
function checkPacket(packet, expectedBaseSha) {
  if (!packet || Object.keys(packet).sort().join(',') !== 'baseSha,package,version' || packet.version !== 1 ||
      !/^[a-f0-9]{40}$/.test(packet.baseSha || '') || packet.baseSha !== expectedBaseSha) throw new Error('Preview packet requires version 1 and the exact checkout base SHA');
  if (Buffer.byteLength(JSON.stringify(packet), 'utf8') > MAX_PACKET_BYTES) throw new Error('Preview packet exceeds 1 MiB');
  const bundle = validatePackage(packet.package);
  if (!['morning','evening'].includes(bundle.edition.variant)) throw new Error('Recovery preview requires an explicit morning or evening edition');
  return bundle;
}

// Structural validation and rendering only. Editorial truth and publication require separate review.
export function previewPackage(root, packet, output, {expectedBaseSha, now = () => new Date()} = {}) {
  root = fs.realpathSync(root);
  if (gitHead(root) !== expectedBaseSha) throw new Error('Checkout does not match expected base SHA');
  const bundle = checkPacket(packet, expectedBaseSha), branch = 'daily/' + bundle.edition.slug;
  validateFreshness(branch, bundle.edition, bundle.articles, now());
  output = path.resolve(output);
  const relative = path.relative(root, output);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Preview output must be outside the source checkout');
  if (fs.existsSync(output)) throw new Error('Preview output already exists');
  const before = loadRepository(root), beforeDigests = digests(before);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jamio-recovery-preview-'));
  let created = false;
  try {
    for (const name of ['content','data','docs','public','scripts','contracts','config','site.config.json']) {
      fs.cpSync(path.join(root, name), path.join(scratch, name), {recursive:true});
    }
    const draft = path.join(scratch, 'drafts', bundle.edition.slug);
    fs.mkdirSync(path.join(draft, 'articles'), {recursive:true});
    fs.writeFileSync(path.join(draft, 'edition.md'), serialize(bundle.edition), {flag:'wx'});
    fs.writeFileSync(path.join(draft, 'prices.json'), JSON.stringify(bundle.priceObservations) + '\n', {flag:'wx'});
    for (const article of bundle.articles) fs.writeFileSync(path.join(draft, 'articles', article.slug + '.md'), serialize(article), {flag:'wx'});
    const plan = planDraft(scratch, draft);
    const changes = plan.writes.map(w => ({file:w.file, mode:'100644', status:w.file === 'data/prices.json' ? 'M' : 'A'}));
    applyDraft(scratch, draft);
    const candidate = loadRepository(scratch);
    const validation = validateDailyChange(branch, changes, before, candidate);
    if (validation.digest !== plan.digest) throw new Error('Preview daily digest mismatch');
    execFileSync(process.execPath, [path.join(scratch, 'scripts/build.mjs')], {
      cwd:scratch, env:{...process.env, GITHUB_SHA:expectedBaseSha}, stdio:'pipe', timeout:60000
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, 'dist/publication.json'), 'utf8'));
    const entry = manifest.editions.find(e => e.slug === bundle.edition.slug);
    if (entry?.digest !== plan.digest || entry.variant !== bundle.edition.variant) throw new Error('Preview build receipt mismatch');
    if (canonical(digests(loadRepository(root))) !== canonical(beforeDigests) || gitHead(root) !== expectedBaseSha) throw new Error('Source checkout changed during preview');
    const freshness = validateFreshness(branch, bundle.edition, bundle.articles, now());
    const result = {status:'preview-ready', mode:'human-reviewed-recovery', baseSha:expectedBaseSha,
      ...validation, ...freshness, existingDigests:beforeDigests,
      packageDigest:sha256(canonical(bundle)), publicationAuthorized:false, editorialReviewRequired:true,
      files:plan.writes.map(w => ({path:w.file, sha256:sha256(w.text), operation:w.file === 'data/prices.json' ? 'append-prices' : 'create'}))};
    fs.mkdirSync(output); created = true;
    fs.writeFileSync(path.join(output, 'README.txt'), 'UNPUBLISHED PREVIEW. This artifact does not authorize publication or prove editorial truth. The site receipt is a hypothetical build at the recorded base SHA, not a deployed receipt. Use a separate reviewed daily PR and exact merged-main public proof.\n', {flag:'wx'});
    fs.cpSync(path.join(scratch, 'dist'), path.join(output, 'site'), {recursive:true});
    fs.writeFileSync(path.join(output, 'candidate-files.json'), JSON.stringify(plan.writes, null, 2) + '\n', {flag:'wx'});
    fs.writeFileSync(path.join(output, 'preview.json'), JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
    return result;
  } catch (error) {
    if (created) fs.rmSync(output, {recursive:true, force:true});
    throw error;
  } finally {
    if (path.dirname(scratch) !== fs.realpathSync(os.tmpdir())) throw new Error('Unexpected preview scratch path');
    fs.rmSync(scratch, {recursive:true, force:true});
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [file, output, ...extra] = process.argv.slice(2);
    if (!file || !output || extra.length) throw new Error('Usage: recovery-preview.mjs <packet.json> <new-output-directory>');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PACKET_BYTES) throw new Error('Packet must be a regular JSON file <=1 MiB');
    const result = previewPackage(process.cwd(), JSON.parse(fs.readFileSync(file, 'utf8')), output, {expectedBaseSha:gitHead(process.cwd())});
    console.log(JSON.stringify(result));
  } catch {
    // Do not echo untrusted packet bodies, source text, or attacker-controlled paths.
    console.error(JSON.stringify({status:'failed', publicationAuthorized:false, error:'Recovery preview rejected; inspect the packet, base and JST freshness locally'}));
    process.exitCode = 1;
  }
}
