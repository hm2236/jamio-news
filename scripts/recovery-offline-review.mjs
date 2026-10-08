import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Turn an already validated, unpublished preview into a single HTML file.
// It works without a server, JavaScript, network requests or browser extensions.
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_CSS_BYTES = 512 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');

function readRegular(file, maxBytes) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new Error('Preview input must be a bounded regular file');
  }
  return fs.readFileSync(file, 'utf8');
}
function readMain(html) {
  const startTag = '<main id="main">';
  const start = html.indexOf(startTag);
  if (start < 0) throw new Error('Built page has no main element');
  const end = html.indexOf('</main>', start + startTag.length);
  if (end < 0 || html.indexOf('<main id="main">', start + startTag.length) !== -1) {
    throw new Error('Built page main element is ambiguous');
  }
  return html.slice(start + startTag.length, end);
}
function localLinks(html) {
  // The offline review only links to its own articles and the embedded edition.
  return html
    .replace(/href="\/jamio-news\/articles\/([a-z0-9-]+)\/"/g, (_, slug) => 'href="#review-' + slug + '"')
    .replace(/href="\/jamio-news\/[^"]*"/g, 'href="#review-top"');
}
function articleMain(html, slug) {
  const section = readMain(html);
  return localLinks(section)
    .replace(/id="(sources|section-[0-9]+)"/g, (_, id) => 'id="review-' + slug + '-' + id + '"')
    .replace(/href="#(sources|section-[0-9]+)"/g, (_, id) => 'href="#review-' + slug + '-' + id + '"');
}
export function createOfflineReview(output) {
  const folder = fs.realpathSync(output);
  const preview = JSON.parse(readRegular(path.join(folder, 'preview.json'), 1024 * 1024));
  if (preview.status !== 'preview-ready' || preview.publicationAuthorized !== false ||
      preview.editorialReviewRequired !== true || !/^[a-f0-9]{40}$/.test(preview.baseSha || '') ||
      !/^\d{4}-\d{2}-\d{2}-(morning|evening)$/.test(preview.slug || '') ||
      !/^[a-f0-9]{64}$/.test(preview.digest || '') || !Array.isArray(preview.files)) {
    throw new Error('A verified unpublished preview receipt is required');
  }
  const slug = preview.slug;
  const editionFile = 'content/editions/' + slug + '.md';
  if (preview.files.filter(row => row.path === editionFile && row.operation === 'create').length !== 1 ||
      preview.files.some(row => !row || typeof row.path !== 'string' ||
        (row.path !== editionFile && row.path !== 'data/prices.json' &&
          !new RegExp('^content/articles/' + slug + '-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$').test(row.path)))) {
    throw new Error('Review candidate file list is unsafe or incomplete');
  }
  const articles = preview.files.filter(row => row.path.startsWith('content/articles/'))
    .map(row => path.basename(row.path, '.md'));
  if (articles.length < 1 || articles.length > 5 ||
      new Set(articles).size !== articles.length ||
      (preview.variant === 'morning' && articles.length !== 5)) {
    throw new Error('Unexpected number of review articles');
  }
  const site = path.join(folder, 'site');
  const manifest = JSON.parse(readRegular(path.join(site, 'publication.json'), 1024 * 1024));
  const entry = manifest.editions?.find(item => item.slug === slug);
  if (manifest.commit !== preview.baseSha || entry?.digest !== preview.digest ||
      entry?.variant !== preview.variant) {
    throw new Error('Hypothetical build manifest does not match preview receipt');
  }
  const css = readRegular(path.join(site, 'assets', 'style.css'), MAX_CSS_BYTES);
  if (/<\/style/i.test(css) || /@import\b/i.test(css) || /url\s*\(/i.test(css)) {
    throw new Error('Offline CSS contains remote-resource syntax');
  }
  const original = readRegular(path.join(site, 'editions', slug, 'index.html'), MAX_HTML_BYTES);
  const issue = readMain(original);
  const stories = articles.map(article => {
    const articleHtml = readRegular(path.join(site, 'articles', article, 'index.html'), MAX_HTML_BYTES);
    return '<section class="offline-review-story" id="review-' + article +
      '"><div class="offline-section-label">ARTICLE / 未公開記事プレビュー</div>' +
      articleMain(articleHtml, article) + '</section>';
  }).join('\n');
  const banner = '<div id="review-top" class="offline-review-banner" role="note">' +
    '<strong>未公開・編集確認用</strong>　GitHub Actionsが生成した仮想紙面です。' +
    '本番公開の証拠ではありません。記事の事実関係とレイアウトを確認してください。' +
    '</div>';
  const extraCss = [
    '.offline-review-banner{position:sticky;top:0;z-index:100;background:#493d29;color:#fff;' +
      'padding:13px 20px;text-align:center;font-size:13px;line-height:1.55}',
    '.offline-review-story{border-top:3px double var(--line);margin:45px auto 0;padding:32px 0 15px;' +
      'max-width:940px;scroll-margin-top:90px}',
    '.offline-section-label{font-size:11px;font-weight:700;letter-spacing:.1em;' +
      'color:var(--muted);margin-bottom:18px}',
    '#theme{display:none}',
    '@media print{.offline-review-banner{position:static;print-color-adjust:exact}' +
      '.offline-review-story{break-before:page}}'
  ].join('\n');

  if (!original.includes('<head>') || !original.includes('</head>') ||
      !original.includes('<body>') || !original.includes('</main>')) {
    throw new Error('Unexpected built HTML layout');
  }
  // JavaScript replacement strings interpret $,   let html = original
, import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Turn an already validated, unpublished preview into a single HTML file.
// It works without a server, JavaScript, network requests or browser extensions.
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_CSS_BYTES = 512 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');

function readRegular(file, maxBytes) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new Error('Preview input must be a bounded regular file');
  }
  return fs.readFileSync(file, 'utf8');
}
function readMain(html) {
  const startTag = '<main id="main">';
  const start = html.indexOf(startTag);
  if (start < 0) throw new Error('Built page has no main element');
  const end = html.indexOf('</main>', start + startTag.length);
  if (end < 0 || html.indexOf('<main id="main">', start + startTag.length) !== -1) {
    throw new Error('Built page main element is ambiguous');
  }
  return html.slice(start + startTag.length, end);
}
function localLinks(html) {
  // The offline review only links to its own articles and the embedded edition.
  return html
    .replace(/href="\/jamio-news\/articles\/([a-z0-9-]+)\/"/g, (_, slug) => 'href="#review-' + slug + '"')
    .replace(/href="\/jamio-news\/[^"]*"/g, 'href="#review-top"');
}
function articleMain(html, slug) {
  const section = readMain(html);
  return localLinks(section)
    .replace(/id="(sources|section-[0-9]+)"/g, (_, id) => 'id="review-' + slug + '-' + id + '"')
    .replace(/href="#(sources|section-[0-9]+)"/g, (_, id) => 'href="#review-' + slug + '-' + id + '"');
}
export function createOfflineReview(output) {
  const folder = fs.realpathSync(output);
  const preview = JSON.parse(readRegular(path.join(folder, 'preview.json'), 1024 * 1024));
  if (preview.status !== 'preview-ready' || preview.publicationAuthorized !== false ||
      preview.editorialReviewRequired !== true || !/^[a-f0-9]{40}$/.test(preview.baseSha || '') ||
      !/^\d{4}-\d{2}-\d{2}-(morning|evening)$/.test(preview.slug || '') ||
      !/^[a-f0-9]{64}$/.test(preview.digest || '') || !Array.isArray(preview.files)) {
    throw new Error('A verified unpublished preview receipt is required');
  }
  const slug = preview.slug;
  const editionFile = 'content/editions/' + slug + '.md';
  if (preview.files.filter(row => row.path === editionFile && row.operation === 'create').length !== 1 ||
      preview.files.some(row => !row || typeof row.path !== 'string' ||
        (row.path !== editionFile && row.path !== 'data/prices.json' &&
          !new RegExp('^content/articles/' + slug + '-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$').test(row.path)))) {
    throw new Error('Review candidate file list is unsafe or incomplete');
  }
  const articles = preview.files.filter(row => row.path.startsWith('content/articles/'))
    .map(row => path.basename(row.path, '.md'));
  if (articles.length < 1 || articles.length > 5 ||
      new Set(articles).size !== articles.length ||
      (preview.variant === 'morning' && articles.length !== 5)) {
    throw new Error('Unexpected number of review articles');
  }
  const site = path.join(folder, 'site');
  const manifest = JSON.parse(readRegular(path.join(site, 'publication.json'), 1024 * 1024));
  const entry = manifest.editions?.find(item => item.slug === slug);
  if (manifest.commit !== preview.baseSha || entry?.digest !== preview.digest ||
      entry?.variant !== preview.variant) {
    throw new Error('Hypothetical build manifest does not match preview receipt');
  }
  const css = readRegular(path.join(site, 'assets', 'style.css'), MAX_CSS_BYTES);
  if (/<\/style/i.test(css) || /@import\b/i.test(css) || /url\s*\(/i.test(css)) {
    throw new Error('Offline CSS contains remote-resource syntax');
  }
  const original = readRegular(path.join(site, 'editions', slug, 'index.html'), MAX_HTML_BYTES);
  const issue = readMain(original);
  const stories = articles.map(article => {
    const articleHtml = readRegular(path.join(site, 'articles', article, 'index.html'), MAX_HTML_BYTES);
    return '<section class="offline-review-story" id="review-' + article +
      '"><div class="offline-section-label">ARTICLE / 未公開記事プレビュー</div>' +
      articleMain(articleHtml, article) + '</section>';
  }).join('\n');
  const banner = '<div id="review-top" class="offline-review-banner" role="note">' +
    '<strong>未公開・編集確認用</strong>　GitHub Actionsが生成した仮想紙面です。' +
    '本番公開の証拠ではありません。記事の事実関係とレイアウトを確認してください。' +
    '</div>';
  const extraCss = [
    '.offline-review-banner{position:sticky;top:0;z-index:100;background:#493d29;color:#fff;' +
      'padding:13px 20px;text-align:center;font-size:13px;line-height:1.55}',
    '.offline-review-story{border-top:3px double var(--line);margin:45px auto 0;padding:32px 0 15px;' +
      'max-width:940px;scroll-margin-top:90px}',
    '.offline-section-label{font-size:11px;font-weight:700;letter-spacing:.1em;' +
      'color:var(--muted);margin-bottom:18px}',
    '#theme{display:none}',
    '@media print{.offline-review-banner{position:static;print-color-adjust:exact}' +
      '.offline-review-story{break-before:page}}'
  ].join('\n');

  if (!original.includes('<head>') || !original.includes('</head>') ||
      !original.includes('<body>') || !original.includes('</main>')) {
    throw new Error('Unexpected built HTML layout');
  }
, and     .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace('</head>', () => '<meta name="robots" content="noindex,nofollow,noarchive">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; ' +
      'style-src &#39;unsafe-inline&#39;; img-src data:; form-action &#39;none&#39;; ' +
      'base-uri &#39;none&#39;; object-src &#39;none&#39;">' +
      '<style>' + css + '\n' + extraCss + '</style></head>')
    .replace('<body>', () => '<body>' + banner)
    .replace(issue + '</main>', () => issue + '<section class="offline-review-articles">' +
      '<div class="section-title"><h2>収録記事の本文プレビュー</h2>' +
      '<span>記事 ' + articles.length + ' 件・未公開</span></div>' +
      stories + '</section></main>');
  html = localLinks(html);
  if (/<script\b/i.test(html) || /<link\b/i.test(html) ||
      /(?:src|href)="\/jamio-news\//.test(html) ||
      !html.includes('offline-review-articles') ||
      !html.includes('offline-review-banner') ||
      !html.includes('<style>')) {
    throw new Error('Offline review must be static, complete and self-contained');
  }
  const target = path.join(folder, 'offline-review.html');
  fs.writeFileSync(target, html, {flag:'wx'});
  const result = {status:'offline-review-ready', file:'offline-review.html',
    baseSha:preview.baseSha, slug, digest:preview.digest, articles:articles.length,
    sha256:sha256(html), publicationAuthorized:false, editorialReviewRequired:true};
  fs.writeFileSync(path.join(folder, 'offline-review.json'), JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [output, ...rest] = process.argv.slice(2);
    if (!output || rest.length) throw new Error('Usage: recovery-offline-review.mjs <unpublished-preview-directory>');
    console.log(JSON.stringify(createOfflineReview(output)));
  } catch {
    console.error(JSON.stringify({status:'failed',publicationAuthorized:false,error:'Offline review export failed'}));
    process.exitCode = 1;
  }
}. Content is
  // untrusted editorial text; callbacks prevent replacement-token expansion.
  let html = original
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace('</head>', () => '<meta name="robots" content="noindex,nofollow,noarchive">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; ' +
      'style-src &#39;unsafe-inline&#39;; img-src data:; form-action &#39;none&#39;; ' +
      'base-uri &#39;none&#39;; object-src &#39;none&#39;">' +
      '<style>' + css + '\n' + extraCss + '</style></head>')
    .replace('<body>', () => '<body>' + banner)
    .replace(issue + '</main>', () => issue + '<section class="offline-review-articles">' +
      '<div class="section-title"><h2>収録記事の本文プレビュー</h2>' +
      '<span>記事 ' + articles.length + ' 件・未公開</span></div>' +
      stories + '</section></main>');
  html = localLinks(html);
  if (/<script\b/i.test(html) || /<link\b/i.test(html) ||
      /(?:src|href)="\/jamio-news\//.test(html) ||
      !html.includes('offline-review-articles') ||
      !html.includes('offline-review-banner') ||
      !html.includes('<style>')) {
    throw new Error('Offline review must be static, complete and self-contained');
  }
  const target = path.join(folder, 'offline-review.html');
  fs.writeFileSync(target, html, {flag:'wx'});
  const result = {status:'offline-review-ready', file:'offline-review.html',
    baseSha:preview.baseSha, slug, digest:preview.digest, articles:articles.length,
    sha256:sha256(html), publicationAuthorized:false, editorialReviewRequired:true};
  fs.writeFileSync(path.join(folder, 'offline-review.json'), JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [output, ...rest] = process.argv.slice(2);
    if (!output || rest.length) throw new Error('Usage: recovery-offline-review.mjs <unpublished-preview-directory>');
    console.log(JSON.stringify(createOfflineReview(output)));
  } catch {
    console.error(JSON.stringify({status:'failed',publicationAuthorized:false,error:'Offline review export failed'}));
    process.exitCode = 1;
  }
}