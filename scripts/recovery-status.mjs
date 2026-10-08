import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {loadRepository} from './production.mjs';
import {confirmPublication} from './confirm-publication.mjs';

const mainURL = 'https://api.github.com/repos/hm2236/jamio-news/git/ref/heads/main';
export async function recoveryStatus(root, {request = fetch, now = () => new Date()} = {}) {
  const head = execFileSync('git', ['rev-parse','HEAD'], {cwd:root, encoding:'utf8'}).trim();
  const readMain = async () => {
    const response = await request(mainURL, {headers:{Accept:'application/vnd.github+json'}, redirect:'error', signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('Current main cannot be read');
    const sha = (await response.json()).object?.sha;
    if (sha !== head) throw new Error('Read-only recovery status requires the exact current main checkout');
    return sha;
  };
  await readMain();
  const repository = loadRepository(root);
  const proofs = [];
  for (const variant of ['morning','evening']) {
    const edition = repository.editions.filter(e => e.variant === variant).sort((a,b) => b.published.localeCompare(a.published))[0];
    if (edition) proofs.push(await confirmPublication(root, edition.slug, head, {request}));
  }
  await readMain();
  const clock = new Date(now());
  if (!Number.isFinite(+clock)) throw new Error('Invalid recovery status clock');
  const date = new Date(+clock + 9 * 3600000).toISOString().slice(0,10);
  return {status:'read-only-audit', checkedAt:clock.toISOString(), baseSha:head, date,
    publicationAuthorized:false, schedulerState:'not-inspected',
    today:{morning:proofs.some(p=>p.slug === date+'-morning') ? 'published' : 'missing',
      evening:proofs.some(p=>p.slug === date+'-evening') ? 'published' : 'editorial-decision-required'},
    latestConfirmed:proofs};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [output, ...extra] = process.argv.slice(2);
    if (!output || extra.length || fs.existsSync(output)) throw new Error('A new output file is required');
    const result = await recoveryStatus(process.cwd());
    fs.writeFileSync(output, JSON.stringify(result,null,2)+'\n', {flag:'wx'});
    console.log(JSON.stringify(result));
  } catch {
    console.error(JSON.stringify({status:'failed', publicationAuthorized:false, error:'Exact-main recovery status could not be verified'}));
    process.exitCode = 1;
  }
}
