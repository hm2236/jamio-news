import {fileURLToPath} from 'node:url';
import {loadRepository} from './production.mjs';
import {readSeries, validateSeries} from './series.mjs';

try {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const repository = loadRepository(root);
  const {articles, editions, prices} = repository;
  const series = validateSeries(readSeries(root), repository);
  console.log(JSON.stringify({status: 'valid', articles: articles.length, editions: editions.length, prices: prices.length, series: series.length}));
} catch (error) {
  console.error(JSON.stringify({status: 'failed', error: error.message}));
  process.exitCode = 1;
}
