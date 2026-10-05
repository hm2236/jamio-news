import test from 'node:test';
import assert from 'node:assert/strict';

test('edition switching changes every issue panel and preserves ordinary modified link navigation',async t=>{
  const morning={dataset:{editionSwitch:'2026-10-06-morning'}},evening={dataset:{editionSwitch:'2026-10-06-evening'}};
  const links=[morning,evening];
  for(const link of links){
    link.attributes={};
    link.setAttribute=(key,value)=>{link.attributes[key]=value;};
    link.removeAttribute=key=>{delete link.attributes[key];};
    link.addEventListener=(type,callback)=>{link[type]=callback;};
  }
  evening.attributes['aria-current']='page';
  const panels=['heading','front','top','deals'].flatMap(()=>links.map(link=>({dataset:{editionPanel:link.dataset.editionSwitch},hidden:link===morning})));
  const priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),priorMedia=Object.getOwnPropertyDescriptor(globalThis,'matchMedia');
  t.after(()=>{
    for(const [key,prior]of [['document',priorDocument],['matchMedia',priorMedia]]){if(prior)Object.defineProperty(globalThis,key,prior);else delete globalThis[key];}
  });
  globalThis.document={documentElement:{dataset:{}},querySelector:()=>null,querySelectorAll:selector=>selector==='[data-edition-switch]'?links:panels};
  globalThis.matchMedia=()=>({matches:false,addEventListener:()=>{}});
  await import('../public/assets/app.js');
  const click=(link,changes={})=>{
    let prevented=false;
    link.click({button:0,preventDefault:()=>{prevented=true;},...changes});return prevented;
  };
  assert.equal(click(morning),true);
  assert.ok(panels.every(panel=>panel.hidden===(panel.dataset.editionPanel===evening.dataset.editionSwitch)));
  assert.equal(morning.attributes['aria-current'],'page');assert.equal(evening.attributes['aria-current'],undefined);
  for(const changes of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]){
    assert.equal(click(evening,changes),false);assert.equal(morning.attributes['aria-current'],'page');
  }
  assert.equal(click(evening),true);
  assert.ok(panels.every(panel=>panel.hidden===(panel.dataset.editionPanel===morning.dataset.editionSwitch)));
  assert.equal(evening.attributes['aria-current'],'page');assert.equal(morning.attributes['aria-current'],undefined);
});
