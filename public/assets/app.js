import {initWeather} from "./weather.js";
const rootURL=new URL('../',import.meta.url);
const $=selector=>document.querySelector(selector);
const theme=$('#theme');
function syncTheme(){const mode=document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');theme?.setAttribute('aria-label',mode==='dark'?'ライトモードに切り替える':'ダークモードに切り替える');}
syncTheme();
theme?.addEventListener('click',()=>{const mode=document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const next=mode==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('jamio-theme',next);}catch{}syncTheme();});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',syncTheme);
initWeather();
if($('#search-form')){
 const query=$('#query'),category=$('#category'),status=$('#status'),count=$('#search-count'),results=$('#results');
 const params=new URLSearchParams(location.search);query.value=params.get('q')||params.get('tag')||'';category.value=params.get('category')||'';status.value=params.get('status')||'';
 const normalize=s=>s.normalize('NFKC').toLocaleLowerCase('ja-JP');
 fetch(new URL('search.json',rootURL)).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(index=>{
  function render(){
   const terms=normalize(query.value).trim().split(/\s+/).filter(Boolean);
   const found=index.filter(a=>(!category.value||a.category===category.value)&&(!status.value||a.status===status.value)&&terms.every(t=>normalize([a.title,a.summary,a.body,...a.tags,...(a.editions??[]).map(e=>e.title)].join(' ')).includes(t)));
   count.textContent=`${found.length}件の記事`;results.replaceChildren();
   if(!found.length){const p=document.createElement('p');p.className='empty';p.textContent='該当する記事はありません。キーワードや条件を変えてください。';results.append(p);}
   for(const a of found){const card=document.createElement('article');card.className='card';const eye=document.createElement('div');eye.className='eyebrow';eye.textContent=a.categoryLabel+' ';const badge=document.createElement('span');badge.className='badge '+a.status;badge.textContent=a.statusLabel;eye.append(badge);const h=document.createElement('h3'),link=document.createElement('a');link.href=a.url;link.textContent=a.title;h.append(link);const p=document.createElement('p');p.textContent=a.summary;const tags=document.createElement('div');tags.className='tags';for(const tag of a.tags){const t=document.createElement('a');t.href=new URL('topics/',rootURL).pathname+'?tag='+encodeURIComponent(tag);t.textContent='#'+tag;tags.append(t);}card.append(eye,h,p,tags);for(const e of a.editions??[]){const issue=document.createElement('a');issue.href=e.url;issue.textContent=e.title;card.append(issue);}results.append(card);}
   const newParams=new URLSearchParams();if(query.value)newParams.set('q',query.value);if(category.value)newParams.set('category',category.value);if(status.value)newParams.set('status',status.value);history.replaceState(null,'',location.pathname+(newParams.size?'?'+newParams:''));
  }
  query.addEventListener('input',render);category.addEventListener('change',render);status.addEventListener('change',render);$('#search-form').addEventListener('submit',e=>{e.preventDefault();render();});render();
 }).catch(()=>{count.textContent='検索データを取得できません。再読み込みするか、カテゴリから記事を開いてください。';});
}
