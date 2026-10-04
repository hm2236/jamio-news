import {fileURLToPath} from 'node:url';
import {loadRepository} from './production.mjs';

try {
  const {articles, editions, prices} = loadRepository(fileURLToPath(new URL('../', import.meta.url)));
  console.log(JSON.stringify({status: 'valid', articles: articles.length, editions: editions.length, prices: prices.length}));
} catch (error) {
  console.error(JSON.stringify({status: 'failed', error: error.message}));
  process.exitCode = 1;
}
