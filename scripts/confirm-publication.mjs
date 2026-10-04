import {contract, isDate} from './contract.mjs';
import {loadRepository, editionDigest, editionURL} from './production.mjs';
import {assertPublicReceipt} from './remote-proof.mjs';

export async function confirmPublication(root, date, commit, {request = fetch} = {}) {
  if (!isDate(date) || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Confirm requires a date and full merged main SHA');
  const {config, articles, editions, prices} = loadRepository(root);
  const edition = editions.find(e => e.slug === date);
  if (!edition) throw new Error('Edition is absent from this checkout; fetch merged main first');
  const editionUrl = editionURL(config, date);
  const digest = editionDigest(edition, articles, prices);
  const get = async (url, github = false) => {
    const headers = {Accept: github ? 'application/vnd.github+json' : '*/*'};
    if (github && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await request(url, {headers, cache: 'no-store', signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`Publication check HTTP ${response.status}: ${url}`);
    return response;
  };
  const repo = contract['x-handoff'].repository;
  const runs = await (await get(`https://api.github.com/repos/${repo}/actions/workflows/pages.yml/runs?head_sha=${commit}&branch=main&per_page=20`, true)).json();
  const run = runs.workflow_runs?.filter(r => r.head_sha === commit && r.head_branch === 'main' && ['push', 'workflow_dispatch'].includes(r.event)).sort((a,b) => b.id - a.id)[0];
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('Pages workflow for this main SHA has not succeeded');
  const manifest = await (await get(new URL(`publication.json?commit=${commit}`, config.url).href)).json();
  const html = await (await get(`${editionUrl}?commit=${commit}`)).text();
  assertPublicReceipt(manifest, {commit, date, editionUrl, digest}, html);
  return {status: 'published', date, editionUrl, commit, digest, workflowUrl: run.html_url};
}
