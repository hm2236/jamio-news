import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Original main pushes retain their place in the serialized Pages queue.
// Recovery attempts must read the live main ref, never a cached checkout ref.
export async function fencePagesDeployment({eventName, ref, sha, runAttempt, repository, token}, {request = fetch} = {}) {
  if (!['push', 'workflow_dispatch'].includes(eventName) || ref !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(sha || '') || !/^[1-9]\d*$/.test(String(runAttempt || ''))) throw new Error('Invalid Pages deployment context');
  if (eventName === 'push' && String(runAttempt) === '1') return {status: 'allowed', reason: 'original-push', commit: sha};
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository || '') || !token) throw new Error('Pages recovery fence requires repository and read token');
  const response = await request(`https://api.github.com/repos/${repository}/git/ref/heads/main`, {
    headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28'},
    cache: 'no-store', signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Pages main-tip fence HTTP ${response.status}`);
  const tip = await response.json();
  if (tip.ref !== 'refs/heads/main' || tip.object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(tip.object?.sha || '')) throw new Error('Invalid live main ref in Pages fence');
  if (tip.object.sha !== sha) throw new Error('Stale Pages rerun/manual dispatch: deployment SHA is not current main tip');
  return {status: 'allowed', reason: 'current-main-tip', commit: sha};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await fencePagesDeployment({eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA, runAttempt: process.env.GITHUB_RUN_ATTEMPT, repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN});
    console.log('JAMIO_PAGES_DEPLOY_FENCE ' + JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({status: 'failed', error: error.message}));
    process.exitCode = 1;
  }
}
