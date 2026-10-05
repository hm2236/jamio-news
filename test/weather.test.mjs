import test from 'node:test';
import assert from 'node:assert/strict';
import {initWeather} from '../public/assets/weather.js';

const now=()=>new Date('2026-10-05T01:00:00Z');
const response=(timezone='Asia/Tokyo',date='2026-10-05')=>({ok:true,json:async()=>({timezone,daily:{time:[date],weather_code:[0],temperature_2m_max:[28],temperature_2m_min:[19],precipitation_probability_max:[20]}})});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element{
 textContent='';dataset={};children=[];disabled=false;listeners={};
 append(el){this.children.push(el);}
 replaceChildren(){this.children=[];}
 addEventListener(type,callback){this.listeners[type]=callback;}
 get text(){return this.textContent+this.children.map(el=>el.text).join(' ');}
}
function setup({geolocation=true,request=async()=>response()}={}){
 const elements=Object.fromEntries(['weather-data','weather-title','weather-location-status','weather-location'].map(id=>[id,new Element()]));
 const calls=[];let success,failure,options;
 const document={querySelector:selector=>elements[selector.slice(1)]??null,createElement:()=>new Element()};
 const navigator=geolocation?{geolocation:{getCurrentPosition:(s,f,o)=>{success=s;failure=f;options=o;}}}:{};
 initWeather({document,navigator,fetch:(url,opts)=>{calls.push({url:new URL(url),options:opts});return request(url,opts);},now});
 return {elements,calls,get options(){return options;},allow:(latitude=35.689487,longitude=139.691706)=>success({coords:{latitude,longitude}}),fail:code=>failure({code}),state:()=>elements['weather-location-status'].dataset.state,text:()=>Object.values(elements).map(e=>e.text).join(' '),retry:()=>elements['weather-location'].listeners.click()};
}

test('pages without a weather panel never request position or weather',()=>{
 initWeather({document:{querySelector:()=>null},navigator:{get geolocation(){assert.fail('position requested');}},fetch:()=>assert.fail('weather requested')});
});
test('first visit requests permission while showing the existing fallback',async()=>{
 const app=setup();assert.equal(app.state(),'pending');assert.equal(app.elements['weather-location'].disabled,true);
 assert.deepEqual(app.options,{enableHighAccuracy:false,timeout:10000,maximumAge:0});
 await tick();assert.match(app.text(),/いちき串木野/);assert.match(app.text(),/28° \/ 19°/);
 assert.equal(app.calls[0].url.searchParams.get('latitude'),'31.72');
});
test('granted position fetches an approximate point without exposing coordinates',async()=>{
 const app=setup();app.allow();await tick();assert.equal(app.state(),'granted');assert.match(app.text(),/今日の現在地付近/);
 const call=app.calls.at(-1);assert.equal(call.url.origin,'https://api.open-meteo.com');assert.equal(call.url.searchParams.get('latitude'),'35.69');assert.equal(call.url.searchParams.get('longitude'),'139.69');assert.equal(call.url.searchParams.get('timezone'),'auto');
 assert.equal(call.options.cache,'no-store');assert.equal(call.options.credentials,'omit');assert.equal(call.options.referrerPolicy,'no-referrer');
 assert.doesNotMatch(app.text(),/35\.69|139\.69/);assert.equal(app.elements['weather-location'].disabled,false);
});
for(const [code,state]of [[1,'denied'],[2,'failed'],[3,'failed']])test(`position error ${code} retains fallback and permits explicit retry`,async()=>{
 const app=setup();app.fail(code);await tick();assert.equal(app.state(),state);assert.equal(app.calls.length,1);assert.match(app.text(),/今日のいちき串木野/);
 app.retry();assert.equal(app.state(),'pending');app.allow();await tick();assert.equal(app.state(),'granted');
});
test('unsupported geolocation uses fallback without a request',async()=>{
 const app=setup({geolocation:false});await tick();assert.equal(app.state(),'unsupported');assert.match(app.text(),/28° \/ 19°/);assert.equal(app.elements['weather-location'].disabled,true);
});
test('synchronous geolocation exceptions and invalid points fall back',async()=>{
 const status=new Element(),button=new Element();
 initWeather({document:{querySelector:s=>({'#weather-data':new Element(),'#weather-title':new Element(),'#weather-location-status':status,'#weather-location':button})[s],createElement:()=>new Element()},navigator:{geolocation:{getCurrentPosition:()=>{throw new Error('blocked');}}},fetch:async()=>response(),now});
 assert.equal(status.dataset.state,'failed');assert.equal(button.disabled,false);
 const app=setup();app.allow(NaN,181);await tick();assert.equal(app.state(),'failed');assert.equal(app.calls.length,1);
});
test('overseas forecasts use the location date rather than JST',async()=>{
 const app=setup({request:async url=>new URL(url).searchParams.get('timezone')==='auto'?response('America/Los_Angeles','2026-10-04'):response()});
 app.allow(34.05,-118.24);await tick();assert.equal(app.state(),'granted');assert.match(app.text(),/2026-10-04 の予報（America\/Los_Angeles）/);assert.match(app.text(),/取得 10:00 JST/);
});
for(const kind of ['http','network','stale','malformed','timezone'])test(`current weather ${kind} failure falls back without showing stale data`,async()=>{
 const app=setup({request:async url=>{
  if(new URL(url).searchParams.get('timezone')!=='auto')return response();
  if(kind==='http')return {ok:false};if(kind==='network')throw new Error('offline');
  if(kind==='stale')return response('Asia/Tokyo','2026-10-04');
  if(kind==='timezone')return response('invalid/timezone');
  return {ok:true,json:async()=>({timezone:'Asia/Tokyo',daily:{}})};
 }});
 app.allow();await tick();assert.equal(app.state(),'weather-failed');assert.match(app.text(),/今日のいちき串木野/);assert.match(app.text(),/28° \/ 19°/);assert.equal(app.calls.length,3);
});
test('when all weather requests fail, display unavailable and the fallback region',async()=>{
 const app=setup({request:async()=>{throw new Error('offline');}});app.allow();await tick();assert.equal(app.state(),'weather-failed');assert.match(app.text(),/今日の予報を取得できませんでした/);assert.match(app.text(),/気象庁/);assert.doesNotMatch(app.text(),/28°/);
});
test('a late fallback response cannot overwrite the current forecast',async()=>{
 let finish;
 const app=setup({request:url=>new URL(url).searchParams.get('timezone')==='auto'?Promise.resolve(response()):new Promise(resolve=>{finish=resolve;})});
 app.allow();await tick();finish(response('Asia/Tokyo','2026-10-04'));await tick();assert.equal(app.state(),'granted');assert.match(app.text(),/今日の現在地付近/);assert.match(app.text(),/28° \/ 19°/);
});
test('late geolocation callbacks after an error cannot switch the region',async()=>{
 const app=setup();app.fail(3);app.allow();await tick();assert.equal(app.state(),'failed');assert.equal(app.calls.length,1);
});
