import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifySeriesDeployment} from './series-proof.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const commit = process.env.GITHUB_SHA;
if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'hm2236/jamio-news') throw new Error('Series publication proof is restricted to trusted repository main');
if (execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8'}).trim() !== commit) throw new Error('Series publication requires checkout of the exact merged main SHA');
let failure;
const deadline = Date.now()+600000;
for (let attempt=0; attempt<20; attempt++) {
  try {
    const receipt = await verifySeriesDeployment(root, commit);
    console.log('JAMIO_SERIES_PUBLIC_RECEIPT '+JSON.stringify(receipt));
    failure=null; break;
  } catch (error) {
    failure=error;
    if (Date.now()>=deadline) break;
    if (attempt<19) await new Promise(resolve=>setTimeout(resolve,Math.min(30000,deadline-Date.now())));
  }
}
if (failure) { console.error(JSON.stringify({status:'failed',error:failure.message})); process.exitCode=1; }
