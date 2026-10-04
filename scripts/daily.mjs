import {fileURLToPath} from 'node:url';
import {planDraft, applyDraft} from './production.mjs';
import {confirmPublication} from './confirm-publication.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const [command, value, commit, ...extra] = process.argv.slice(2);
try {
  if (extra.length || (command !== 'confirm' && commit)) throw new Error('Unexpected arguments');
  let result;
  if (command === 'check' && value) {
    const plan = planDraft(root, value);
    result = {status: 'valid', date: plan.date, editionUrl: plan.editionUrl, digest: plan.digest, files: plan.writes.map(w => w.file)};
  } else if (command === 'apply' && value) result = applyDraft(root, value);
  else if (command === 'confirm') result = await confirmPublication(root, value, commit);
  else throw new Error('Usage: daily.mjs check|apply drafts/YYYY-MM-DD OR confirm YYYY-MM-DD <merged-main-sha>');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({status: 'failed', error: error.message}));
  process.exitCode = 1;
}
