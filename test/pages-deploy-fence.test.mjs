import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fencePagesDeployment} from '../scripts/pages-deploy-fence.mjs';

const sha = 'a'.repeat(40), later = 'b'.repeat(40);
const context = {eventName: 'push', ref: 'refs/heads/main', sha, runAttempt: '2', repository: 'hm2236/jamio-news', token: 'fixture-read-token'};
const tip = commit => ({ref: 'refs/heads/main', object: {type: 'commit', sha: commit}});
const reply = value => async () => new Response(JSON.stringify(value));

test('original main push attempt 1 may deploy while main has advanced, without a tip lookup', async () => {
  const result = await fencePagesDeployment({...context, runAttempt: '1', token: undefined}, {request: async () => {throw new Error('Original push must preserve its queue position');}});
  assert.equal(result.reason, 'original-push');
});

for (const eventName of ['push', 'workflow_dispatch']) {
  test(`${eventName} recovery at current main tip is allowed using a fresh read-only ref lookup`, async () => {
    const result = await fencePagesDeployment({...context, eventName}, {request: async (url, options) => {
      assert.equal(url, 'https://api.github.com/repos/hm2236/jamio-news/git/ref/heads/main');
      assert.equal(options.method, undefined); // fetch defaults to GET
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers.Authorization, 'Bearer fixture-read-token');
      return new Response(JSON.stringify(tip(sha)));
    }});
    assert.equal(result.reason, 'current-main-tip');
  });
  test(`${eventName} recovery of a stale SHA fails before Pages write`, async () => {
    let writes = 0;
    await assert.rejects(async () => {
      await fencePagesDeployment({...context, eventName}, {request: reply(tip(later))});
      writes++; // stand-in for the next deploy-pages action, never a real deployment
    }, /Stale Pages/);
    assert.equal(writes, 0);
  });
  test(`${eventName} stale CLI exits nonzero so the workflow cannot reach deploy-pages`, () => {
    const preload = 'data:text/javascript,' + encodeURIComponent(`globalThis.fetch = async () => new Response(${JSON.stringify(JSON.stringify(tip(later)))});`);
    const result = spawnSync(process.execPath, ['--import', preload, fileURLToPath(new URL('../scripts/pages-deploy-fence.mjs', import.meta.url))], {
      encoding: 'utf8', env: {...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_REF: context.ref, GITHUB_SHA: sha, GITHUB_RUN_ATTEMPT: '2', GITHUB_REPOSITORY: context.repository, GITHUB_TOKEN: context.token}
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Stale Pages/);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes(context.token));
  });
}

test('manual dispatch attempt 1 still checks the current main tip', async () => {
  assert.equal((await fencePagesDeployment({...context, eventName: 'workflow_dispatch', runAttempt: '1'}, {request: reply(tip(sha))})).reason, 'current-main-tip');
  await assert.rejects(fencePagesDeployment({...context, eventName: 'workflow_dispatch', runAttempt: '1'}, {request: reply(tip(later))}), /Stale Pages/);
});

test('bad context, non-main refs, unavailable or malformed live main fail closed', async () => {
  for (const changes of [{eventName: 'pull_request'}, {ref: 'refs/heads/old'}, {ref: 'refs/tags/main'}, {sha: 'short'}, {runAttempt: '0'}, {runAttempt: '2x'}, {runAttempt: undefined}, {repository: '../wrong'}, {token: undefined}]) {
    await assert.rejects(fencePagesDeployment({...context, ...changes}, {request: reply(tip(sha))}));
  }
  for (const value of [{}, {...tip(sha), ref: 'refs/heads/old'}, {ref: 'refs/heads/main', object: {type: 'tag', sha}}, tip('short')]) {
    await assert.rejects(fencePagesDeployment(context, {request: reply(value)}), /Invalid live main/);
  }
  await assert.rejects(fencePagesDeployment(context, {request: async () => new Response('', {status: 403})}), /HTTP 403/);
  await assert.rejects(fencePagesDeployment(context, {request: async () => {throw new Error('network unavailable');}}), /network unavailable/);
  await assert.rejects(fencePagesDeployment(context, {request: async () => new Response('invalid JSON')}));
});

test('Pages workflow queues the entire build/deploy/receipt run and gates the Pages write', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /\nconcurrency:\n  group: pages-\$\{\{ github.ref \}\}\n  queue: max\njobs:/);
  assert.doesNotMatch(workflow, /cancel-in-progress:/);
  assert.doesNotMatch(workflow, /contents: write|write-all/);
  const build = workflow.slice(workflow.indexOf('\n  build:'), workflow.indexOf('\n  deploy:'));
  assert.match(build, /if: github.event_name == 'workflow_dispatch' && github.ref != 'refs\/heads\/main'\n        run: \|\n          echo .*\n          exit 1/);
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.match(deploy, /needs: build/);
  assert.match(deploy, /ref: \$\{\{ github.sha \}\}\n          persist-credentials: false/);
  assert.match(deploy, /- name: Fence stale Pages deployment\n        env:\n          GITHUB_TOKEN: \$\{\{ github.token \}\}\n        run: node scripts\/pages-deploy-fence.mjs\n      - name: Deploy\n        id: deployment\n        uses: actions\/deploy-pages@v4/);
  assert.doesNotMatch(deploy, /continue-on-error:|if:.*always\(/);
  const deployAt = deploy.indexOf('uses: actions/deploy-pages@v4');
  assert.ok(deploy.indexOf('actions/checkout@v6') < deployAt);
  assert.ok(deploy.indexOf('actions/setup-node@v4') < deployAt);
  assert.ok(deployAt < deploy.indexOf('node scripts/verify-deployment.mjs'));
  assert.ok(deployAt < deploy.indexOf('node scripts/verify-series-deployment.mjs'));
});
