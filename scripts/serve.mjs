import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
const base=new URL(JSON.parse(fs.readFileSync(new URL('../site.config.json',import.meta.url))).url).pathname;
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.xml':'application/xml; charset=utf-8','.svg':'image/svg+xml'};
http.createServer((req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p.startsWith(base))p=p.slice(base.length);else p=p.replace(/^\//,'');let target=path.resolve(root,p);if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');if(!fs.existsSync(target)){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(root,'404.html')));return;}res.writeHead(200,{'Content-Type':mime[path.extname(target)]??'text/plain; charset=utf-8'});res.end(fs.readFileSync(target));}catch{res.writeHead(400);res.end();}}).listen(4173,'127.0.0.1',()=>console.log(`Preview http://127.0.0.1:4173${base}`));
