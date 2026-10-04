import {fileURLToPath} from 'node:url';
import {initDraft} from './production.mjs';
const date = process.argv[2] || new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo'}).format(new Date());
try {
  console.log(JSON.stringify(initDraft(fileURLToPath(new URL('../', import.meta.url)), date)));
} catch (error) {
  console.error(JSON.stringify({status: 'failed', error: error.message}));
  process.exitCode = 1;
}
