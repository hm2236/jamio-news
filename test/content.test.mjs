import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readContent,validate,markdown,priceStats,validatePrices} from '../scripts/content.mjs';
const config=JSON.parse(fs.readFileSync(new URL('../site.config.json',import.meta.url)));
const articles=readContent(new URL('../content/articles',import.meta.url));
const editions=readContent(new URL('../content/editions',import.meta.url));
const make=(changes={})=>({...articles[0],slug:'test-news',kind:'news',status:'verified',sources:[{title:'公式',type:'official',url:'https://example.com/news',checked:'2026-10-04T08:00:00+09:00'}],...changes});
test('published content meets editorial requirements',()=>validate(articles,editions,config));
test('X alone cannot establish a verified fact, even if mislabeled official',()=>{
 assert.throws(()=>validate([make({sources:[{title:'X',type:'official',url:'https://x.com/example/status/123',checked:'2026-10-04T08:00:00+09:00'}],verificationNote:'裏取りなし'})],[],config),/一次資料/);
});
test('alternate X host spelling or a media label cannot bypass source policy',()=>{
 const sources=[{title:'X',type:'official',url:'https://x.com./example/status/123',checked:'2026-10-04T08:00:00+09:00'}];
 assert.throws(()=>validate([make({sources,verificationNote:'裏取りなし'})],[],config),/一次資料/);
 sources[0].type='media';assert.throws(()=>validate([make({status:'reported',sources,verificationNote:'裏取りなし'})],[],config),/報道機関/);
});
test('news requires evidence and X requires a verification note',()=>{
 assert.throws(()=>validate([make({sources:[]})],[],config),/出典/);
 assert.throws(()=>validate([make({status:'unconfirmed',sources:[{title:'投稿',type:'x',url:'https://x.com/example/status/123',checked:'2026-10-04T08:00:00+09:00'}]})],[],config),/検証状況/);
});
test('daily edition cannot silently recycle launch guides',()=>assert.throws(()=>validate(articles,[{...editions[0],kind:'daily'}],config),/開設ガイド/));
test('missing article references stop publication',()=>assert.throws(()=>validate(articles,[{...editions[0],hero:'missing'}],config),/記事参照/));
test('Markdown treats raw HTML as text and refuses executable links',()=>{
 const html=markdown('<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n[ok](https://example.com)\n\n**大事**');
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('<strong>大事</strong>'));assert.ok(html.includes('href="https://example.com"'));
});
const row=(observed,total,changes={})=>({product:'GPU',sku:'exact-sku',shop:'shop-a',condition:'新品・条件なし',currency:'JPY',url:'https://fixture-shop.example.jp/shop',observed,total,verdict:'wait',reason:'監視',...changes});
test('30-day change compares same SKU shop and terms; no baseline means no invented percentage',()=>{
 const rows=[row('2026-09-01T08:00:00+09:00',100000),row('2026-09-03T08:00:00+09:00',10000,{sku:'other'}),row('2026-09-04T08:00:00+09:00',20000,{shop:'other'}),row('2026-10-04T08:00:00+09:00',90000)];
 const stats=priceStats(rows,'GPU');assert.equal(stats.change,-10);assert.equal(stats.low,90000);
 assert.equal(priceStats([rows.at(-1)],'GPU').change,null);
 assert.equal(priceStats([row('2026-08-01T08:00:00+09:00',100000),rows.at(-1)],'GPU').change,null);
});
test('price observations require payment total, source and reason',()=>{validatePrices([row('2026-10-04T08:00:00+09:00',100000)]);assert.throws(()=>validatePrices([row('2026-10-04T08:00:00+09:00',-1)]));});
