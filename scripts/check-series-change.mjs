import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from './content.mjs';
import {loadRepository, assertStableEditions} from './production.mjs';
import {readSeries, validateSeries, assertSeriesTransition} from './series.mjs';

export function checkSeriesChange(root, baseSha) {
  if (!/^[a-f0-9]{40}$/.test(baseSha || '')) throw new Error('Series change check requires exact base SHA');
  const git = args => execFileSync('git', args, {cwd:root, encoding:'utf8',maxBuffer:16*1024*1024});
  const files = git(['ls-tree','-r','--name-only',baseSha]).trim().split('\n');
  const read = file => git(['show',`${baseSha}:${file}`]);
  const content = prefix => files.filter(f => f.startsWith(prefix) && f.endsWith('.md')).map(f => parse(read(f), f));
  const base = {config:JSON.parse(read('site.config.json')), articles:content('content/articles/'), editions:content('content/editions/'), prices:JSON.parse(read('data/prices.json'))};
  const registry = files.filter(f => f.startsWith('data/series/')).map(file => {
    if (!file.endsWith('.json') || !git(['ls-tree',baseSha,'--',file]).startsWith('100644 ')) throw new Error('Invalid base registry file');
    const series = JSON.parse(read(file));
    if (file !== `data/series/${series.id}.json`) throw new Error('Base id/filename mismatch');
    return series;
  });
  const candidate = loadRepository(root), next = readSeries(root);
  validateSeries(registry, base); validateSeries(next, candidate);
  assertSeriesTransition(registry, next);
  if (git(['diff','--name-only',baseSha,'--','data/series']).trim()) assertStableEditions(base, candidate);
  return {status:'series-change-valid',baseSha,series:next.length};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(checkSeriesChange(process.cwd(), process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode=1; }
}
