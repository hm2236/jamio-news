const fallback={latitude:31.72,longitude:130.27,timezone:'Asia/Tokyo'};
const fallbackName='鹿児島県いちき串木野市';
function placeName(data){
 if(!['coordinates','reverseGeocoding'].includes(data?.lookupSource))throw new Error('location');
 const clean=value=>typeof value==='string'?value.trim():'';
 const region=clean(data.principalSubdivision),city=clean(data.city),locality=clean(data.locality);
 const administrative=Array.isArray(data.localityInfo?.administrative)?data.localityInfo.administrative:[];
 const municipality=data.countryCode==='JP'?[city,locality,...administrative.map(a=>clean(a.name)).reverse()].find(name=>/[市区町村]$/.test(name)):city||locality;
 if(!municipality||(data.countryCode==='JP'&&!region))throw new Error('location');
 return [...new Set([data.countryCode==='JP'?'':clean(data.countryName),region,municipality].filter(Boolean))].join(' ');
}
const codes={0:'晴れ',1:'おおむね晴れ',2:'晴れ時々曇り',3:'曇り',45:'霧',48:'霧',51:'小雨',53:'霧雨',55:'霧雨',56:'着氷性の霧雨',57:'着氷性の霧雨',61:'雨',63:'雨',65:'強い雨',66:'着氷性の雨',67:'着氷性の雨',71:'雪',73:'雪',75:'大雪',77:'雪',80:'にわか雨',81:'にわか雨',82:'強いにわか雨',85:'にわか雪',86:'にわか雪',95:'雷雨',96:'雷雨',99:'雷雨'};

export function initWeather({document=globalThis.document,navigator=globalThis.navigator,fetch=globalThis.fetch,now=()=>new Date()}={}){
 const weather=document.querySelector('#weather-data');
 if(!weather)return;
 const title=document.querySelector('#weather-title'),status=document.querySelector('#weather-location-status'),button=document.querySelector('#weather-location');
 let request=0;
 const text=(tag,content,className)=>{const el=document.createElement(tag);el.textContent=content;if(className)el.className=className;weather.append(el);};
 const locationStatus=(state,message)=>{status.dataset.state=state;status.textContent=message;};
 async function forecast(point,isCurrent=false,name=fallbackName){
  const id=++request;
  title.textContent=`今日の${name}`;
  weather.replaceChildren();text('p','予報を読み込み中','small');
  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.search=new URLSearchParams({...point,daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',forecast_days:1});
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(8000),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
   if(!response.ok)throw new Error('weather');
   const data=await response.json();
   if(id!==request)return;
   const timezone=isCurrent?data.timezone:fallback.timezone;
   if(typeof timezone!=='string')throw new Error('timezone');
   const today=new Intl.DateTimeFormat('sv-SE',{timeZone:timezone}).format(now());
   const d=data.daily;
   if(!d||d.time?.[0]!==today||![d.weather_code?.[0],d.temperature_2m_max?.[0],d.temperature_2m_min?.[0],d.precipitation_probability_max?.[0]].every(Number.isFinite))throw new Error('stale');
   weather.replaceChildren();text('p',`${today} の予報（${timezone}）`,'small');text('p',codes[d.weather_code[0]]??'予報を確認','weather-condition');text('p',`${Math.round(d.temperature_2m_max[0])}° / ${Math.round(d.temperature_2m_min[0])}°`,'temperature');text('p',`最高 / 最低 · 降水確率 ${d.precipitation_probability_max[0]}％`,'small');text('p',`取得 ${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(now())} JST`,'small');
  }catch{
   if(id!==request)return;
   if(isCurrent){locationStatus('weather-failed',`現在地の予報を取得できません。${fallbackName}の予報です。`);await forecast(fallback);return;}
   weather.replaceChildren();text('p','今日の予報を取得できませんでした。','weather-condition');text('p','下の気象庁リンクで確認できます。','small');
  }
 }
 function locate(){
  if(button.disabled)return;
  if(!navigator?.geolocation){locationStatus('unsupported',`位置情報に未対応のため、${fallbackName}の予報です。`);button.disabled=true;return;}
  button.disabled=true;
  locationStatus('pending',`位置情報を確認中。取得までは${fallbackName}の予報です。`);
  let settled=false;
  const fail=error=>{if(settled)return;settled=true;button.disabled=false;locationStatus(error?.code===1?'denied':'failed',error?.code===1?`位置情報は未許可。${fallbackName}の予報です。再取得は下の詳細から。`:`位置情報を取得できません。${fallbackName}の予報です。`);};
  try{
   navigator.geolocation.getCurrentPosition(async position=>{
    if(settled)return;
    const {latitude,longitude}=position.coords??{};
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180){fail();return;}
    settled=true;
    locationStatus('pending',`地名を確認中。取得までは${fallbackName}の予報です。`);
    try{
     // Only live, permitted device coordinates go to this client-only endpoint.
     const url=new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
     url.search=new URLSearchParams({latitude,longitude,localityLanguage:'ja'});
     const response=await fetch(url,{signal:AbortSignal.timeout(8000),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
     if(!response.ok)throw new Error('location');
     const name=placeName(await response.json());
     locationStatus('granted','現在地付近の予報です。');
     // Approximate only the forecast point; never persist or render coordinates.
     await forecast({latitude:latitude.toFixed(2),longitude:longitude.toFixed(2),timezone:'auto'},true,name);
    }catch{
     locationStatus('geocoding-failed',`現在地の地名を取得できません。${fallbackName}の予報です。`);
     await forecast(fallback);
    }finally{button.disabled=false;}
   },fail,{enableHighAccuracy:false,timeout:10000,maximumAge:0});
  }catch{fail();}
 }
 button.addEventListener('click',()=>{if(button.disabled)return;void forecast(fallback);locate();});
 void forecast(fallback);
 locate();
}
