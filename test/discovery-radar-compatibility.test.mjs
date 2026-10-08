import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {brotliCompressSync} from 'node:zlib';
import {canonical,digest,emptyState,seenRecords,updateSeen,validateState,validateSourceConfig,createCompatibility,validateCandidate,recoverState,packageCapture,WORKFLOW,REPOSITORY} from '../scripts/discovery-radar.mjs';
import {LEGACY_SOURCE_CONFIG,LEGACY_CONFIG_DIGEST,LEGACY_CONTRACT_DIGEST,LEGACY_STATE_POLICY_DIGEST,policyFingerprint} from '../scripts/discovery-radar-compatibility.mjs';

const at = '2026-10-08T12:17:00.000Z', later = '2026-10-08T12:17:01.000Z', now = Date.parse(later);
const config = () => structuredClone(LEGACY_SOURCE_CONFIG);
const run = id => ({id,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',path:WORKFLOW,repository:{full_name:REPOSITORY},status:'completed',conclusion:'success',created_at:at,event:'schedule'});
function ledger() {
  const state = emptyState();
  for (let i = 1; i <= 30; i++) {
    const source = config().sources[(i-1)%3];
    const url = source.id === 'hn-new' ? `https://news.ycombinator.com/item?id=${i}` : source.id === 'kagoshima-new' ? `https://www.pref.kagoshima.jp/fixture-${i}.html` : `https://www.anthropic.com/news/fixture-${i}`;
    const identifiers = [`url:${source.id}:${url}`];
    if (source.id === 'hn-new') identifiers.push(`item:${source.id}:${i}`);
    if (source.id === 'kagoshima-new') identifiers.push(`item:${source.id}:urn:fixture:${i}`);
    state.observations[digest(`fixture-observation-${i}`)] = {firstAt:at,lastAt:at,seenAt:[at],identifiers,channelClass:source.channelClass};
  }
  state.sourceCursors = Object.fromEntries(config().sources.map(s => [s.id,at]));
  state.seen = seenRecords(state);
  return state;
}
const proof = () => ({sourceUrl:'http://www.pref.kagoshima.jp/new-proof.html',httpsUrl:'https://www.pref.kagoshima.jp/new-proof.html',method:'visible-text-and-canonical-url',httpStatus:200,httpsStatus:200,normalizedTextDigest:digest('equal'),verifiedAt:at});
function additive() { const next = config(); next.sources[1].httpsEquivalence.push(proof()); return next; }
function candidate({version=2,sourceConfig=config(),state=ledger(),kind='rolling',id=10}={}) {
  const stateBytes = brotliCompressSync(Buffer.from(canonical(state)+'\n'));
  const r = run(id);
  const metadata = version === 1 ? {contractDigest:LEGACY_CONTRACT_DIGEST,sourceConfigDigest:LEGACY_CONFIG_DIGEST} : createCompatibility(sourceConfig);
  const m = {version,kind,repository:REPOSITORY,workflow:WORKFLOW,branch:'main',producer:{runId:String(id),attempt:1,headSha:r.head_sha},startedAt:at,completedAt:later,githubRetentionDays:90,retentionCapability:'ok',...metadata,previousStateDigest:null,stateDigest:digest(state),payloadDigest:digest(stateBytes),stateEncoding:'brotli-canonical-json-v1',imported:null,coldStart:true,health:'degraded'};
  return {kind,artifactId:id+100,runId:String(id),attempt:1,run:r,manifest:{...m,manifestDigest:digest(m)},stateBytes};
}
function resign(c) { const {manifestDigest,...unsigned} = c.manifest; c.manifest.manifestDigest = digest(unsigned); }
function replaceState(c,state) { c.stateBytes=brotliCompressSync(Buffer.from(canonical(state)+'\n')); c.manifest.payloadDigest=digest(c.stateBytes);c.manifest.stateDigest=digest(state);resign(c); }
const count = state => Object.keys(state.observations).length;
const recover = (c,next=config()) => recoverState({rolling:c},createCompatibility(next),now);
function packageRecovery(recovery,next) {
  const result = {state:recovery.state,observations:[],sourceHealth:[],newObservationCount:0,duplicateObservationCount:0,perLaneCounts:{watch:0,discover:0,sentinel:0},newlySeenIdentifiers:[]};
  return packageCapture(result,recovery,{existingCheckpoint:false},{...run(20),startedAt:at,completedAt:later,sourceRequests:0,responseBytes:0},createCompatibility(next),90);
}

test('legacy audited literal is immutable and matches its exact config digest',()=>{
  assert.equal(digest(LEGACY_SOURCE_CONFIG),LEGACY_CONFIG_DIGEST);
  assert.equal(createCompatibility(config()).statePolicyDigest,LEGACY_STATE_POLICY_DIGEST);
  assert.throws(()=>{LEGACY_SOURCE_CONFIG.sources[1].httpsEquivalence.pop();});
});
for (const version of [1,2]) test(`v${version} additive equivalence preserves all30 observations and original digest; only Kagoshima cursor clears`,()=>{
  const prior=candidate({version}), next=additive(), recovery=recover(prior,next);
  assert.equal(recovery.seenState,'ok');assert.equal(count(recovery.state),30);
  assert.deepEqual(recovery.state.observations,ledger().observations);
  assert.equal(recovery.imported.stateDigest,prior.manifest.stateDigest);
  assert.equal(recovery.state.sourceCursors['kagoshima-new'],undefined);
  assert.equal(recovery.state.sourceCursors['hn-new'],at);assert.equal(recovery.state.sourceCursors['anthropic-news'],at);
  assert.deepEqual(recovery.migrations,[{sourceId:'kagoshima-new',action:'preserved-ledger-cleared-cursor'}]);
  const out=packageRecovery(recovery,next), manifest=JSON.parse(out.rolling['manifest.json']);
  assert.equal(out.report.health,'degraded');assert.deepEqual(out.report.stateMigrations,recovery.migrations);
  assert.equal(manifest.version,2);assert.equal(manifest.previousStateDigest,prior.manifest.stateDigest);
  assert.notEqual(manifest.stateDigest,manifest.previousStateDigest);
  const roundtrip={kind:'rolling',artifactId:200,runId:'20',attempt:1,run:run(20),manifest,stateBytes:out.rolling['state/seen.json.br']};
  const again=recover(roundtrip,next);assert.equal(count(again.state),30);assert.deepEqual(again.migrations,[]);assert.equal(again.failures.length,0);
  const [observationId,row]=Object.entries(again.state.observations)[0];
  assert.equal(updateSeen(again.state,[{observationId,identifiers:row.identifiers,channelClass:row.channelClass,observedAt:later}],now).duplicateObservationCount,1);
  assert.equal(count(again.state),30);validateState(again.state,now);
});
test('unchanged descriptors preserve all ledgers/cursors without migration or manufactured identities',()=>{
  const prior=candidate(),r=recover(prior);assert.deepEqual(r.state,ledger());assert.deepEqual(r.migrations,[]);
});
for (const [name,change,sourceId] of [
  ['proof removal',c=>c.sources[1].httpsEquivalence.pop(),'kagoshima-new'],
  ['proof replacement',c=>c.sources[1].httpsEquivalence[0].normalizedTextDigest=digest('new-proof'),'kagoshima-new'],
  ['permitted item limit',c=>c.sources[2].maxItems=19,'anthropic-news'],
  ['proof reorder',c=>c.sources[1].httpsEquivalence.reverse(),'kagoshima-new']
]) test(`${name} resets only affected source and reports degraded`,()=>{
  const next=config();change(next);const r=recover(candidate(),next);
  assert.equal(count(r.state),20);assert.equal(r.state.sourceCursors[sourceId],undefined);
  assert.deepEqual(r.migrations,[{sourceId,action:'reset-source'}]);
  assert.ok(Object.values(r.state.observations).every(row=>!row.identifiers.some(k=>k.startsWith(`url:${sourceId}:`))));
  assert.equal(packageRecovery(r,next).report.health,'degraded');validateState(r.state,now);
});
test('removing added proofs on rollback resets only Kagoshima rather than importing aliases',()=>{
  const r=recover(candidate({sourceConfig:additive()}),config());assert.equal(count(r.state),20);
  assert.deepEqual(r.migrations,[{sourceId:'kagoshima-new',action:'reset-source'}]);
});
for (const [name,mutate] of [
  ['legacy schema',c=>c.manifest.contractDigest=digest('unknown-schema')],
  ['legacy source snapshot digest',c=>c.manifest.sourceConfigDigest=digest('unknown-source')]
]) test(`unknown ${name} fails closed`,()=>{
  const c=candidate({version:1});mutate(c);resign(c);const r=recover(c);assert.equal(r.seenState,'cold-start');assert.equal(count(r.state),0);assert.equal(r.failures[0].code,'legacy-compatibility');
});
for (const [name,mutate] of [
  ['unknown policy',c=>c.manifest.statePolicyDigest=digest('unknown-policy')],
  ['unknown full contract',c=>c.manifest.contractDigest=digest('unknown-schema')],
  ['unknown manifest version',c=>c.manifest.version=3],
  ['unknown encoding',c=>c.manifest.stateEncoding='future-v3'],
  ['snapshot digest',c=>c.manifest.sourceConfig.sources[2].maxItems=19],
  ['snapshot unknown source',c=>{c.manifest.sourceConfig.sources[0].id='foreign';c.manifest.sourceConfigDigest=digest(c.manifest.sourceConfig);}],
  ['snapshot duplicate source',c=>{c.manifest.sourceConfig.sources[1]=structuredClone(c.manifest.sourceConfig.sources[0]);c.manifest.sourceConfigDigest=digest(c.manifest.sourceConfig);}],
  ['snapshot missing source',c=>{c.manifest.sourceConfig.sources.pop();c.manifest.sourceConfigDigest=digest(c.manifest.sourceConfig);}]
]) test(`v2 rejects ${name} with re-signed manifest`,()=>{
  const c=candidate();mutate(c);resign(c);const r=recover(c);assert.equal(r.seenState,'cold-start');assert.equal(count(r.state),0);
});
for (const [name,change] of [
  ['unknown config field',c=>c.extra=true],['unknown source field',c=>c.sources[1].extra=true],
  ['proof bound',c=>c.sources[1].httpsEquivalence=Array.from({length:21},()=>proof())],
  ['oversized snapshot',c=>c.sources[1].httpsEquivalence[0].sourceUrl='x'.repeat(13*1024)],
  ['duplicate proof',c=>c.sources[1].httpsEquivalence.push(structuredClone(c.sources[1].httpsEquivalence[0]))],
  ['proof unknown field',c=>c.sources[1].httpsEquivalence[0].extra=true],
  ['proof missing field',c=>delete c.sources[1].httpsEquivalence[0].method],
  ['proof foreign source',c=>c.sources[0].httpsEquivalence=[proof()]],
  ['proof malformed URL',c=>c.sources[1].httpsEquivalence[0].sourceUrl='bad'],
  ['proof query',c=>c.sources[1].httpsEquivalence[0].sourceUrl+='?token=bad'],
  ['proof credential',c=>c.sources[1].httpsEquivalence[0].sourceUrl='http://user:password@www.pref.kagoshima.jp/test'],
  ['proof nonexact upgrade',c=>c.sources[1].httpsEquivalence[0].httpsUrl='https://www.pref.kagoshima.jp/other'],
  ['proof invalid time',c=>c.sources[1].httpsEquivalence[0].verifiedAt='tomorrow'],
  ['proof invalid hash',c=>c.sources[1].httpsEquivalence[0].normalizedTextDigest='sha256:broken'],
  ['proof invalid method',c=>c.sources[1].httpsEquivalence[0].method='guess'],
  ['proof failed status',c=>c.sources[1].httpsEquivalence[0].httpsStatus=404]
]) test(`source config rejects ${name}`,()=>{const next=config();change(next);assert.throws(()=>validateSourceConfig(next));});
for (const [name,poison] of [
  ['mixed source',row=>row.identifiers[1]='item:kagoshima-new:123'],
  ['wrong channel',row=>row.channelClass='publisher'],
  ['malformed URL',row=>row.identifiers[0]='url:hn-new:not-a-url'],
  ['foreign host',row=>row.identifiers[0]='url:hn-new:https://evil.invalid/item?id=1'],
  ['URL item mismatch',row=>row.identifiers[1]='item:hn-new:999'],
  ['repeated URL kind',row=>row.identifiers[1]='url:hn-new:https://news.ycombinator.com/item?id=999'],
  ['HTTP canonical URL',row=>row.identifiers[0]='url:hn-new:http://news.ycombinator.com/item?id=1'],
  ['empty item',row=>row.identifiers[1]='item:hn-new:'],
  ['future row time',row=>{row.lastAt='2026-10-09T12:00:00.000Z';row.seenAt.push(row.lastAt);}]
]) test(`self-consistent payload rejects poisoned ${name} before migration`,()=>{
  const c=candidate(),state=ledger(),row=Object.values(state.observations)[0];poison(row);state.seen=seenRecords(state);replaceState(c,state);
  assert.equal(recover(c,additive()).seenState,'cold-start');
});
for (const [name,sourceId,url,item] of [
  ['Kagoshima cross-host','kagoshima-new','https://www.anthropic.com/news/other','urn:test'],
  ['Kagoshima URL query','kagoshima-new','https://www.pref.kagoshima.jp/test?x=1','urn:test'],
  ['Anthropic path','anthropic-news','https://www.anthropic.com/about',null],
  ['Anthropic item binding','anthropic-news','https://www.anthropic.com/news/test','unexpected']
]) test(`rejects ${name} with correct source-qualified prefix`,()=>{
  const state=emptyState(),source=config().sources.find(s=>s.id===sourceId);
  state.observations[digest('bad-row')]={firstAt:at,lastAt:at,seenAt:[at],identifiers:[`url:${sourceId}:${url}`,...(item?[`item:${sourceId}:${item}`]:[])],channelClass:source.channelClass};state.seen=seenRecords(state);
  assert.throws(()=>validateState(state,now));
});
for (const [name,change] of [
  ['coldStart pointer',m=>m.coldStart=false],['orphan previous pointer',m=>m.previousStateDigest=digest('previous')],
  ['imported coldStart',m=>m.imported={artifactId:1,runId:'9',attempt:1,kind:'rolling',stateDigest:digest('previous')}],
  ['mismatched imported digest',m=>{m.coldStart=false;m.previousStateDigest=digest('previous');m.imported={artifactId:1,runId:'9',attempt:1,kind:'rolling',stateDigest:digest('different')};}]
]) test(`rejects internally inconsistent chain ${name}`,()=>{const c=candidate();change(c.manifest);resign(c);assert.equal(recover(c).failures[0].code,'state-chain');});
test('invalid rolling snapshot falls back to bounded valid checkpoint with original checkpoint pointer',()=>{
  const rolling=candidate();rolling.manifest.sourceConfigDigest=digest('bad');resign(rolling);
  const checkpoint=candidate({version:1,kind:'checkpoint',id:9});
  const r=recoverState({rolling,checkpoint},createCompatibility(additive()),now);
  assert.equal(r.seenState,'recovered-gap');assert.equal(count(r.state),30);assert.equal(r.imported.stateDigest,checkpoint.manifest.stateDigest);assert.equal(r.failures.length,1);
});
test('state bytes, strict UTF8 and bounded decompression reject corruption before ledger acceptance',()=>{
  const c=candidate();c.stateBytes=Buffer.from('bad');assert.equal(recover(c).failures[0].code,'payload-digest');
  c.manifest.payloadDigest=digest(c.stateBytes);resign(c);assert.equal(recover(c).failures[0].code,'state-decode');
  const invalid=Buffer.concat([Buffer.from('{"version":1,"observations":{},"sourceCursors":{},"seen":[],"'),Buffer.from([0xc0,0xaf]),Buffer.from('":0}')]);
  c.stateBytes=brotliCompressSync(invalid);c.manifest.payloadDigest=digest(c.stateBytes);c.manifest.stateDigest=digest(JSON.parse(invalid.toString('utf8')));resign(c);
  assert.equal(recover(c).failures[0].code,'state-decode');
  c.stateBytes=brotliCompressSync(Buffer.alloc(8*1024*1024+1,32));c.manifest.payloadDigest=digest(c.stateBytes);resign(c);assert.equal(recover(c).failures[0].code,'state-decode');
});
test('Seen mismatch and unknown state version are rejected even with recomputed payload/state/manifest digests',()=>{
  const c=candidate(),state=ledger();state.seen[0].uniqueObservationCount90d++;replaceState(c,state);assert.equal(recover(c).failures[0].code,'seen-ledger-mismatch');
  state.version=2;replaceState(c,state);assert.equal(recover(c).seenState,'cold-start');
});
test('policy fingerprint binds indirect Seen schema and Observation semantics, while provenance changes stay separate',()=>{
  const contract=JSON.parse(fs.readFileSync(new URL('../contracts/discovery-radar.schema.json',import.meta.url),'utf8'));
  const original=policyFingerprint(contract);contract.$defs.seen.properties.uniqueObservationCount90d.minimum=2;assert.notEqual(policyFingerprint(contract),original);
  const next=JSON.parse(fs.readFileSync(new URL('../contracts/discovery-radar.schema.json',import.meta.url),'utf8'));next.$defs.report.description='presentation change';assert.equal(policyFingerprint(next),original);assert.notEqual(digest(next),createCompatibility(config()).contractDigest);
});
test('malformed consumer compatibility cannot grant acceptance or produce a manifest',()=>{
  const current=createCompatibility(config());current.statePolicyDigest=digest('arbitrary');const c=candidate();assert.throws(()=>validateCandidate(c.manifest,c.stateBytes,c,current,now),/consumer-compatibility/);
});
test('producer-completion boundary rejects post-capture rows and cursors even before consumer time',()=>{
  const consumerNow=now+3600000;
  for (const kind of ['row','cursor']) {
    const c=candidate(),state=ledger();
    if (kind === 'row') { const row=Object.values(state.observations)[0];row.lastAt=new Date(now+1000).toISOString();row.seenAt.push(row.lastAt);state.seen=seenRecords(state); }
    else state.sourceCursors['hn-new']=new Date(now+1000).toISOString();
    replaceState(c,state);assert.equal(recoverState({rolling:c},createCompatibility(config()),consumerNow).seenState,'cold-start');
  }
});
test('state chain rejects importing another attempt of the producing run without assuming numeric run-id chronology',()=>{
  const c=candidate();c.manifest.imported={artifactId:1,runId:c.runId,attempt:2,kind:'rolling',stateDigest:digest('previous')};c.manifest.previousStateDigest=c.manifest.imported.stateDigest;c.manifest.coldStart=false;resign(c);assert.equal(recover(c).failures[0].code,'state-chain');
});
test('future verified proof fails closed in previous or current source snapshot',()=>{
  const next=additive();next.sources[1].httpsEquivalence.at(-1).verifiedAt=new Date(now+1000).toISOString();
  assert.throws(()=>recover(candidate(),next),/equivalence-future/);
  assert.equal(recover(candidate({sourceConfig:next}),config()).failures[0].code,'equivalence-future');
});
test('future current config stops runtime compatibility and no-artifact recovery before capture',()=>{
  const next=additive();next.sources[1].httpsEquivalence.at(-1).verifiedAt=new Date(now+1000).toISOString();
  assert.throws(()=>createCompatibility(next,now),/equivalence-future/);
  assert.throws(()=>recoverState({},createCompatibility(next),now),/equivalence-future/);
  const current=createCompatibility(config());current.statePolicyDigest=digest('unsupported');
  assert.throws(()=>recoverState({},current,now),/consumer-compatibility/);
});
