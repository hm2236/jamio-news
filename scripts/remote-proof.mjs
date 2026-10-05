import {dailyIdentity} from './daily-pr.mjs';
import {editionIdentity, receiptIdentityMatches} from './edition.mjs';
import {escape} from './content.mjs';

const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const succeeded = (run, workflow, event) => run?.path === `.github/workflows/${workflow}` && run.event === event && run.status === 'completed' && run.conclusion === 'success';
function editionURLMatches(value, slug) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith(`/editions/${slug}/`); } catch { return false; }
}

// Executable specification for the API-only handoff; scheduled ChatGPT evaluates
// these same fields from GitHub JSON/logs. It does not need to run this module.
export function validateRemotePR({pr, expectedHead, expectedBase, latestMainSha, guardRun, guardReceipt, buildRun}) {
  const identity = dailyIdentity(pr.head.ref), {date} = identity;
  if (!sha(expectedHead) || !sha(expectedBase) || pr.state !== 'open' || pr.base.ref !== 'main' || pr.head.sha !== expectedHead || pr.base.sha !== expectedBase || latestMainSha !== expectedBase || pr.head.repo.full_name !== pr.base.repo.full_name) throw new Error('PR head/base changed or is not a same-repository daily PR');
  const guardedPR = guardRun?.pull_requests?.find(item => item.number === pr.number);
  if (!succeeded(guardRun, 'daily-publication.yml', 'pull_request_target') || ![expectedHead, expectedBase].includes(guardRun.head_sha) || guardedPR?.head?.sha !== expectedHead || guardedPR?.base?.sha !== expectedBase || guardReceipt.status !== 'guard-passed' || guardReceipt.contractVersion !== 1 || guardReceipt.pr !== pr.number || guardReceipt.headSha !== expectedHead || guardReceipt.baseSha !== expectedBase || !receiptIdentityMatches(guardReceipt, identity) || !editionURLMatches(guardReceipt.editionUrl, identity.slug) || !/^[a-f0-9]{64}$/.test(guardReceipt.digest)) throw new Error('Trusted guard did not validate this exact PR head/base');
  if (!succeeded(buildRun, 'pages.yml', 'pull_request') || buildRun.head_sha !== expectedHead || buildRun.head_branch !== pr.head.ref) throw new Error('Mandatory PR validation/test/build did not succeed for this exact head');
  return {status: 'validated', pr: pr.number, ...identity, headSha: expectedHead, baseSha: expectedBase, editionUrl: guardReceipt.editionUrl, digest: guardReceipt.digest};
}
export function assertPublicReceipt(manifest, {commit, date, slug = date, variant, editionUrl, digest}, html) {
  const identity = editionIdentity(slug);
  if (identity.date !== date || (variant !== undefined && identity.variant !== variant)) throw new Error('Mismatched receipt identity');
  const matches = manifest.editions?.filter(e => receiptIdentityMatches(e, identity)) || [];
  const item = matches.length === 1 ? matches[0] : null;
  if (manifest.contractVersion !== 1 || manifest.commit !== commit || item?.digest !== digest || item?.url !== editionUrl) throw new Error('Public publication manifest is stale or mismatched');
  if (!html.includes(`<link rel="canonical" href="${escape(editionUrl)}">`) || !html.includes(`<meta name="jamio-edition-digest" content="${digest}">`)) throw new Error('Public edition HTML is stale or mismatched');
}
export function confirmRemotePublication({validated, mergeResult, mergedPR, mainRun, manifest, html, deploymentProof}) {
  const commit = mergeResult.sha;
  if (validated.status !== 'validated' || mergeResult.merged !== true || !sha(commit) || mergedPR.number !== validated.pr || mergedPR.merged !== true || mergedPR.merge_commit_sha !== commit || mergedPR.head.sha !== validated.headSha) throw new Error('Merge did not publish the validated head');
  if (!(succeeded(mainRun, 'pages.yml', 'push') || succeeded(mainRun, 'pages.yml', 'workflow_dispatch')) || mainRun.head_sha !== commit || mainRun.head_branch !== 'main') throw new Error('Pages workflow for merged main SHA has not succeeded');
  if (deploymentProof) {
    const identity = editionIdentity(validated.slug || validated.date);
    const matches = deploymentProof.editions?.filter(e => receiptIdentityMatches(e,identity)) || [];
    const item = matches.length === 1 ? matches[0] : null, verified = deploymentProof.verifiedEdition;
    if (deploymentProof.status !== 'receipt-verified' || deploymentProof.contractVersion !== 1 || deploymentProof.commit !== commit || item?.url !== validated.editionUrl || item?.digest !== validated.digest || !receiptIdentityMatches(verified, identity) || verified?.url !== validated.editionUrl || verified?.digest !== validated.digest) throw new Error('Actions public receipt proof is stale or mismatched');
  } else assertPublicReceipt(manifest, {...validated, commit}, html);
  return {status: 'published', ...editionIdentity(validated.slug || validated.date), editionUrl: validated.editionUrl, commit, digest: validated.digest, workflowUrl: mainRun.html_url, pr: validated.pr, validatedHead: validated.headSha};
}
