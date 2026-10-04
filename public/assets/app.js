const rootURL=new URL('../',import.meta.url);
const $=selector=>document.querySelector(selector);
const theme=$('#theme');
function syncTheme(){const mode=document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');theme?.setAttribute('aria-label',mode==='dark'?'ライトモードに切り替える':'ダークモードに切り替える');}
syncTheme();
theme?.addEventListener('click',()=>{const mode=document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const next=mode==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('jamio-theme',next);}catch{}syncTheme();});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',syncTheme);
const weather=$('#weather-data');
if(weather){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
 const url='https://api.open-meteo.com/v1/forecast?latitude=31.72&longitude=130.27&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=1';
 const text=(tag,content,className)=>{const el=document.createElement(tag);el.textContent=content;if(className)el.className=className;weather.append(el);};
 const codes={0:'晴れ',1:'おおむね晴れ',2:'晴れ時々曇り',3:'曇り',45:'霧',48:'霧',51:'小雨',53:'霧雨',55:'霧雨',56:'着氷性の霧雨',57:'着氷性の霧雨',61:'雨',63:'雨',65:'強い雨',66:'着氷性の雨',67:'着氷性の雨',71:'雪',73:'雪',75:'大雪',77:'雪',80:'にわか雨',81:'にわか雨',82:'強いにわか雨',85:'にわか雪',86:'にわか雪',95:'雷雨',96:'雷雨',99:'雷雨'};
 fetch(url,{signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw new Error('weather');return r.json();}).then(data=>{
  const d=data.daily;if(!d||d.time?.[0]!==today||![d.temperature_2m_max?.[0],d.temperature_2m_min?.[0],d.precipitation_probability_max?.[0]].every(Number.isFinite))throw new Error('stale');
  weather.replaceChildren();text('p',`${today} の予報`,'small');text('p',codes[d.weather_code?.[0]]??'予報を確認','weather-condition');text('p',`${Math.round(d.temperature_2m_max[0])}° / ${Math.round(d.temperature_2m_min[0])}°`,'temperature');text('p',`最高 / 最低 · 降水確率 ${d.precipitation_probability_max[0]}％`,'small');text('p',`取得 ${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date())} JST`,'small');
 }).catch(()=>{weather.replaceChildren();text('p','今日の予報を取得できませんでした。','weather-condition');text('p','下の気象庁リンクで確認できます。','small');});
}
if($('#search-form')){
 const query=$('#query'),category=$('#category'),status=$('#status'),count=$('#search-count'),results=$('#results');
 const params=new URLSearchParams(location.search);query.value=params.get('q')||params.get('tag')||'';category.value=params.get('category')||'';status.value=params.get('status')||'';
 const normalize=s=>s.normalize('NFKC').toLocaleLowerCase('ja-JP');
 fetch(new URL('search.json',rootURL)).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(index=>{
  function render(){
   const terms=normalize(query.value).trim().split(/\s+/).filter(Boolean);
   const found=index.filter(a=>(!category.value||a.category===category.value)&&(!status.value||a.status===status.value)&&terms.every(t=>normalize([a.title,a.summary,a.body,...a.tags].join(' ')).includes(t)));
   count.textContent=`${found.length}件の記事`;results.replaceChildren();
   if(!found.length){const p=document.createElement('p');p.className='empty';p.textContent='該当する記事はありません。キーワードや条件を変えてください。';results.append(p);}
   for(const a of found){const card=document.createElement('article');card.className='card';const eye=document.createElement('div');eye.className='eyebrow';eye.textContent=a.categoryLabel+' ';const badge=document.createElement('span');badge.className='badge '+a.status;badge.textContent=a.statusLabel;eye.append(badge);const h=document.createElement('h3'),link=document.createElement('a');link.href=a.url;link.textContent=a.title;h.append(link);const p=document.createElement('p');p.textContent=a.summary;const tags=document.createElement('div');tags.className='tags';for(const tag of a.tags){const t=document.createElement('a');t.href=new URL('topics/',rootURL).pathname+'?tag='+encodeURIComponent(tag);t.textContent='#'+tag;tags.append(t);}card.append(eye,h,p,tags);results.append(card);}
   const newParams=new URLSearchParams();if(query.value)newParams.set('q',query.value);if(category.value)newParams.set('category',category.value);if(status.value)newParams.set('status',status.value);history.replaceState(null,'',location.pathname+(newParams.size?'?'+newParams:''));
  }
  query.addEventListener('input',render);category.addEventListener('change',render);status.addEventListener('change',render);$('#search-form').addEventListener('submit',e=>{e.preventDefault();render();});render();
 }).catch(()=>{count.textContent='検索データを取得できません。再読み込みするか、カテゴリから記事を開いてください。';});
}
