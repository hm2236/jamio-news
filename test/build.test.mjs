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
 const rss=fs.readFileSync(path.join(dir,'rss.xml'),'utf8');assert.equal((rss.match(/<item>/g)??[]).length,articles.length+editions.length);assert.ok(rss.includes('https://hm2236.github.io/jamio-news/editions/2026-10-04/'));
 const index=JSON.parse(fs.readFileSync(path.join(dir,'search.json'),'utf8'));assert.equal(index.length,articles.length);assert.ok(index.every(a=>a.url.startsWith('/jamio-news/articles/')));
 const receipt=JSON.parse(fs.readFileSync(path.join(dir,'publication.json'),'utf8'));assert.match(receipt.commit,/^[a-f0-9]{40}$/);assert.equal(receipt.editions.length,editions.length);
 for(const e of receipt.editions)assert.ok(fs.readFileSync(path.join(dir,`editions/${e.date}/index.html`),'utf8').includes(e.digest));
});
