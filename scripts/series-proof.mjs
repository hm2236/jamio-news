import {loadRepository, canonical} from './production.mjs';
import {readSeries, seriesViews, seriesManifest} from './series.mjs';
import {seriesMetadata, seriesHeading, seriesNavigation, seriesList, registryMetadata, seriesIndex} from './series-html.mjs';
import {escape} from './content.mjs';
import {verifyDeployment} from './verify-deployment.mjs';

const fail = message => { throw new Error(`Series publication: ${message}`); };
const exactlyOnce = (html, fragment) => {
  if (html.split(fragment).length !== 2) fail('HTML metadata/navigation is missing, duplicated or mismatched');
};
export function assertSeriesManifest(actual, expected) {
  if (!/^[a-f0-9]{40}$/.test(expected.commit || '') || canonical(actual) !== canonical(expected)) fail('manifest stale or mismatched');
}
export function assertSeriesHTML(html, url, view, member = null, views = []) {
  exactlyOnce(html, `<link rel="canonical" href="${escape(url)}">`);
  exactlyOnce(html, seriesMetadata(view));
  if (member) {
    exactlyOnce(html, seriesHeading(view, member));
    exactlyOnce(html, seriesNavigation(view, member));
  } else exactlyOnce(html, seriesList(view, views));
}
export function assertSeriesIndexHTML(html, manifest, views) {
  exactlyOnce(html, `<link rel="canonical" href="${escape(manifest.url)}">`);
  exactlyOnce(html, registryMetadata(manifest));
  exactlyOnce(html, seriesIndex(views, manifest));
}

// Additional proof: never substitutes for edition publication verification.
export async function verifySeriesDeployment(root, commit, {request = fetch} = {}) {
  await verifyDeployment(root, commit, {request});
  const repository = loadRepository(root), registry = readSeries(root);
  const views = seriesViews(registry, repository);
  const expected = seriesManifest(registry, views, commit, repository.config.url);
  const get = async url => {
    const response = await request(`${url}${url.includes('?') ? '&' : '?'}commit=${commit}`, {cache:'no-store', signal:AbortSignal.timeout(15000)});
    if (!response.ok) fail(`HTTP ${response.status}`);
    return response;
  };
  const manifest = await (await get(new URL('series-publication.json', repository.config.url).href)).json();
  assertSeriesManifest(manifest, expected);
  assertSeriesIndexHTML(await (await get(expected.url)).text(), expected, views);
  const verifiedURLs = [expected.url];
  for (const view of views) {
    assertSeriesHTML(await (await get(view.url)).text(), view.url, view, null, views);
    verifiedURLs.push(view.url);
    for (const member of view.members) {
      assertSeriesHTML(await (await get(member.url)).text(), member.url, view, member);
      verifiedURLs.push(member.url);
    }
  }
  return {status:'series-receipt-verified', ...expected, verifiedURLs};
}

// Caller must obtain receipt from the authenticated exact-main deploy job log.
// Copied JSON or PR-build logs are not accepted as a publication authority.
export function assertRemoteSeriesPublication({mainRun, editionReceipt, receipt, expected, expectedURLs}) {
  if (mainRun?.path !== '.github/workflows/pages.yml' || !['push','workflow_dispatch'].includes(mainRun.event) || mainRun.head_branch !== 'main' || mainRun.head_sha !== expected.commit || mainRun.status !== 'completed' || mainRun.conclusion !== 'success') fail('exact main Pages workflow has not succeeded');
  if (editionReceipt?.status !== 'receipt-verified' || editionReceipt.contractVersion !== 1 || editionReceipt.commit !== expected.commit || !editionReceipt.verifiedEdition || !editionReceipt.editions?.some(e => canonical(e) === canonical(editionReceipt.verifiedEdition))) fail('matching existing edition receipt is required');
  if (receipt?.status !== 'series-receipt-verified') fail('missing verified receipt');
  const {status, verifiedURLs, ...manifest} = receipt;
  assertSeriesManifest(manifest, expected);
  if (!Array.isArray(expectedURLs) || !Array.isArray(verifiedURLs) || new Set(verifiedURLs).size !== verifiedURLs.length || canonical(verifiedURLs) !== canonical(expectedURLs) || !verifiedURLs.includes(expected.url) || expected.series.some(s => !verifiedURLs.includes(s.url))) fail('incomplete verified series URLs');
  return {status:'series-published', ...expected, workflowUrl:mainRun.html_url};
}
