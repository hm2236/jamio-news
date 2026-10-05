import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readContent} from '../scripts/content.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('every generated internal link works beneath the GitHub Pages repository path',()=>{
 execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root});
 const dir=path.join(root,'dist');const files=fs.readdirSync(dir,{recursive:true}).filter(p=>p.endsWith('.html'));
 assert.ok(files.length>=18);
 for(const file of files){const html=fs.readFileSync(path.join(dir,file),'utf8');for(const match of html.matchAll(/(?:href|src)="(\/[^"?#]*)(?:[?#][^"]*)?"/g)){
   assert.ok(match[1].startsWith('/jamio-news/'),`${file}: wrong base path ${match[1]}`);
   const rel=match[1].slice('/jamio-news/'.length);let target=path.join(dir,rel);if(match[1].endsWith('/'))target=path.join(target,'index.html');assert.ok(fs.existsSync(target),`${file}: broken link ${match[1]}`);
 }}
 const articles=readContent(path.join(root,'content/articles')),editions=readContent(path.join(root,'content/editions'));
 const home=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 assert.ok(home.includes('data-state="unrequested"'));
 assert.ok(home.includes('id="weather-location"'));
 assert.ok(home.includes('概略の位置をOpen-Meteoへ送信'));
 assert.ok(home.includes('天気の取得と位置情報の利用にはJavaScriptが必要'));
 assert.ok(fs.existsSync(path.join(dir,'assets/weather.js')));
 assert.ok(fs.readFileSync(path.join(dir,'policy/index.html'),'utf8').includes('ブラウザストレージには保存せず'));
 const rss=fs.readFileSync(path.join(dir,'rss.xml'),'utf8');assert.equal((rss.match(/<item>/g)??[]).length,articles.length+editions.length);assert.ok(rss.includes('https://hm2236.github.io/jamio-news/editions/2026-10-04/'));
 const index=JSON.parse(fs.readFileSync(path.join(dir,'search.json'),'utf8'));assert.equal(index.length,articles.length);assert.ok(index.every(a=>a.url.startsWith('/jamio-news/articles/')));
 const receipt=JSON.parse(fs.readFileSync(path.join(dir,'publication.json'),'utf8'));assert.match(receipt.commit,/^[a-f0-9]{40}$/);assert.equal(receipt.editions.length,editions.length);
 for(const e of receipt.editions)assert.ok(fs.readFileSync(path.join(dir,`editions/${e.date}/index.html`),'utf8').includes(e.digest));
 const front=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 assert.ok(front.includes('AI・PC・VR/VRC・鹿児島'));
 assert.ok(front.includes('href="/jamio-news/categories/vr/">VR機器・VRChat（VRC）</a>'));
 const vr=fs.readFileSync(path.join(dir,'categories/vr/index.html'),'utf8');
 assert.ok(vr.includes('aria-current="page" href="/jamio-news/categories/vr/"'));
 assert.equal(vr.includes('この面の記事はまだありません。'),!articles.some(a=>a.category==='vr'));
 for(const term of ['Meta Quest','PC VR','SteamVR','OpenXR','Valve','Meta','HTC','PICO','Bigscreen','アイトラッキング','フェイストラッキング','ハンドトラッキング','フルトラ','無線化','GPU要件','価格・在庫','VRChat本体','SDK','Creator Economy','Trust &amp; Safety','アバター / ワールド制作','イベント・コミュニティ','買い替え','必要スペック','VRC体験','日本での価格・発売時期']){
  assert.ok(vr.includes(term),`VR category description missing ${term}`);
  assert.ok(fs.readFileSync(path.join(dir,'policy/index.html'),'utf8').includes(term),`editorial policy missing ${term}`);
 }
 const topics=fs.readFileSync(path.join(dir,'topics/index.html'),'utf8');
 for(const tag of ['VR機器','VRChat','VRC','Meta Quest','PC VR','SteamVR','OpenXR','フルトラ'])assert.ok(topics.includes(`href="?tag=${encodeURIComponent(tag)}">${tag}</a>`));
 for(const page of ['topics','search'])assert.ok(fs.readFileSync(path.join(dir,page,'index.html'),'utf8').includes('<option value="vr">VR機器・VRChat（VRC）</option>'));
 assert.ok(fs.readFileSync(path.join(dir,'sitemap.xml'),'utf8').includes('https://hm2236.github.io/jamio-news/categories/vr/'));
});
