import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertSchema, contract, isDate, isJST, isX, validateDailyEdition} from './contract.mjs';
export const labels = { verified: '確認済み事実', reported: '報道', unconfirmed: '未確認情報', editorial: '編集方針' };
export const escape = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeURL(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol); } catch { return false; }
}
export function parse(text, filename = '') {
  const match = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${filename}: JSON front matter が必要です`);
  return { ...JSON.parse(match[1]), body: match[2], slug: path.basename(filename, '.md') };
}
export function readContent(folder) {
  if(folder instanceof URL)folder=fileURLToPath(folder);
  return fs.readdirSync(folder).filter(f => f.endsWith('.md')).sort().map(f => parse(fs.readFileSync(path.join(folder,f),'utf8'), f));
}
export function validate(articles, editions, config) {
  const slugs = new Set();
  for (const a of articles) {
    if (!/^[a-z0-9-]+$/.test(a.slug) || slugs.has(a.slug)) throw new Error(`重複または無効なslug: ${a.slug}`);
    slugs.add(a.slug);
    if (!a.title || !a.summary || !config.categories[a.category] || !Array.isArray(a.tags)) throw new Error(`${a.slug}: title, summary, category, tags が必要です`);
    if (!labels[a.status] || !['news','guide'].includes(a.kind)) throw new Error(`${a.slug}: 無効な status / kind`);
    if (a.kind === 'news' && a.status === 'editorial') throw new Error(`${a.slug}: ニュースに編集方針は使えません`);
    if (a.kind === 'guide' && a.status !== 'editorial') throw new Error(`${a.slug}: ガイドは編集方針としてください`);
    if (!isJST(a.published)) throw new Error(`${a.slug}: JSTの published が必要です`);
    const sources = a.sources ?? [];
    if (a.kind === 'news' && !sources.length) throw new Error(`${a.slug}: ニュースには出典が必要です`);
    for (const s of sources) {
      if (!s.title || !safeURL(s.url) || !['official','paper','github','blog','media','x'].includes(s.type) || !Number.isFinite(Date.parse(s.checked))) throw new Error(`${a.slug}: 無効な出典`);
    }
    if (a.status === 'verified' && !sources.some(s => ['official','paper','github','blog'].includes(s.type) && !isX(s))) throw new Error(`${a.slug}: X以外の一次資料での確認が必要です`);
    if (a.status === 'reported' && !sources.some(s => s.type === 'media' && !isX(s))) throw new Error(`${a.slug}: 報道機関の出典が必要です`);
    if (sources.some(isX) && a.kind === 'news' && !a.verificationNote) throw new Error(`${a.slug}: Xの検証状況を verificationNote に記載してください`);
  }
  for (const e of editions) {
    if (!isDate(e.slug) || !isJST(e.published) || e.published.slice(0,10)!==e.slug || !e.title || !['launch','daily'].includes(e.kind)) throw new Error(`${e.slug}: 無効な朝刊`);
    if (!Array.isArray(e.top5) || e.top5.length !== 5 || new Set(e.top5).size !== 5 || !Array.isArray(e.articles) || new Set(e.articles).size !== e.articles.length || !e.top5.every(s => e.articles.includes(s)) || !e.articles.every(s => slugs.has(s)) || !e.articles.includes(e.hero)) throw new Error(`${e.slug}: トップ5・一面・記事参照を確認してください`);
    if (e.kind === 'daily' && e.articles.some(s => articles.find(a => a.slug === s).kind !== 'news')) throw new Error(`${e.slug}: 日刊号に開設ガイドを入れないでください`);
    if (!Array.isArray(e.deals) || !e.deals.every(s => e.articles.includes(s) && articles.find(a=>a.slug===s).category==='deals')) throw new Error(`${e.slug}: セール参照が無効です`);
    if (e.kind === 'daily') validateDailyEdition(articles,e);
  }
}
function inline(line) {
  const tokens=[];
  const token=html=> { const i=tokens.push(html)-1; return `\u0000${i}\u0000`; };
  let text=line.replace(/`([^`]+)`/g,(_,code)=>token(`<code>${escape(code)}</code>`));
  text=text.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g,(_,label,url)=>token(safeURL(url)?`<a href="${escape(url)}" rel="noopener noreferrer">${escape(label)}</a>`:escape(label)));
  text=escape(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  return text.replace(/\u0000(\d+)\u0000/g,(_,i)=>tokens[Number(i)]);
}
// Deliberately safe Markdown subset: no raw HTML or executable links.
export function markdown(body) {
  const lines=body.replace(/\r/g,'').split('\n'); const out=[];
  let paragraph=[], list=null, code=null;
  const flush=()=>{if(paragraph.length){out.push(`<p>${paragraph.map(inline).join(' ')}</p>`);paragraph=[];}if(list){out.push(`</${list}>`);list=null;}};
  for(const line of lines){
    if(line.startsWith('```')){flush();if(code){out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);code=null;}else code=[];continue;}
    if(code){code.push(line);continue;}
    if(!line.trim()){flush();continue;}
    const h=line.match(/^(#{1,6})\s+(.+)$/);if(h){flush();out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);continue;}
    const li=line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);if(li){if(paragraph.length)flush();const type=/^\s*\d/.test(line)?'ol':'ul';if(list!==type){flush();list=type;out.push(`<${type}>`);}out.push(`<li>${inline(li[1])}</li>`);continue;}
    if(line.startsWith('> ')){flush();out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);continue;}
    if(/^---+$/.test(line)){flush();out.push('<hr>');continue;}
    if(list)flush();paragraph.push(line);
  }
  flush();if(code)throw new Error('閉じていないコードブロック');return out.join('\n');
}
export function priceStats(rows, product) {
  const list=rows.filter(r=>r.product===product).sort((a,b)=>Date.parse(a.observed)-Date.parse(b.observed));
  if(!list.length)return null;
  const current=list.at(-1), cutoff=Date.parse(current.observed)-30*86400000;
  // Same product/SKU, capacity, shop and purchase terms only.
  const comparable=list.filter(r=>r.sku===current.sku && r.shop===current.shop && r.condition===current.condition && r.currency===current.currency);
  const previous=comparable.filter(r=>Date.parse(r.observed)<=cutoff).at(-1);
  const baseline=previous && cutoff-Date.parse(previous.observed)<=7*86400000 ? previous:null;
  return {current, baseline, change:baseline?100*(current.total-baseline.total)/baseline.total:null, low:Math.min(...comparable.map(r=>r.total)), history:list};
}
export function validatePrices(rows) {
  assertSchema(rows,{type:'array',items:contract.$defs.price},'prices');
  const keys=new Set();
  for(const row of rows){const key=JSON.stringify([row.sku,row.shop,row.condition,row.observed]);if(keys.has(key))throw new Error('Duplicate price observation');keys.add(key);}
  for(const r of rows){if(!r.product||!r.sku||!r.shop||!r.condition||r.currency!=='JPY'||!Number.isFinite(r.total)||r.total<=0||!safeURL(r.url)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(r.observed)||!Number.isFinite(Date.parse(r.observed))||!['buy','conditional','wait'].includes(r.verdict)||!r.reason)throw new Error('価格データはSKU、税込送料込みのtotal、JST観測時刻、条件、出典、判断理由が必要です');}
}
