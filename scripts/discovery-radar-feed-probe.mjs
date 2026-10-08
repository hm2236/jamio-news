import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {publicAddress,pinnedRequest,digest,canonical} from './discovery-radar.mjs';

export const PRODUCT_TOKEN = 'JAMIO-ReadOnly-Feed-Probe';
export const USER_AGENT = PRODUCT_TOKEN+'/1.0';
export const DEADLINE_MS = 8000;
export const ROBOTS_BUDGET = 64*1024;
export const FEED_BUDGET = 256*1024;
export const TARGETS = Object.freeze([
  Object.freeze({sourceId:'openai-news',robotsUrl:'https://openai.com/robots.txt',feedUrl:'https://openai.com/news/rss.xml'}),
  Object.freeze({sourceId:'github-changelog',robotsUrl:'https://github.blog/robots.txt',feedUrl:'https://github.blog/changelog/feed/'})
]);
export const WARNING = '::warning::Official feed reachability remains unproven for one or more fixed sources. No retries, alternate targets, adapter changes, or publication authority are granted.';
export const FAILURE = '::error::Official feed probe failed its environment or implementation checks.';
const REPOSITORY = 'hm2236/jamio-news';
const WORKFLOW = '.github/workflows/discovery-radar-feed-probe.yml';
const root = fileURLToPath(new URL('..',import.meta.url));
const endpointMap = new Map(TARGETS.flatMap(target=>[[target.robotsUrl,{kind:'robots',maxBytes:ROBOTS_BUDGET}],[target.feedUrl,{kind:'feed',maxBytes:FEED_BUDGET}]]));
class ProbeFailure extends Error { constructor(code,status=null,bytes=0) { super(code);this.status=status;this.bytes=bytes; } }
const normal = (code,status=null,bytes=0) => { throw new ProbeFailure(code,status,bytes); };
const implementation = () => { throw new Error('feed-probe-implementation'); };
const networkCodes = new Set(['ENOTFOUND','EAI_AGAIN','ETIMEOUT','ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','EPIPE','EAI_FAIL']);
const ordinaryError=error=>error instanceof Error&&error.constructor===Error;
function bounded(promise,ms,code) {
  let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ProbeFailure(code)),ms);});
  return Promise.race([promise,deadline]).finally(()=>clearTimeout(timer));
}
export function robotsPolicy(text,feedPath) {
  if (typeof text !== 'string' || Buffer.byteLength(text)>ROBOTS_BUDGET || !['/news/rss.xml','/changelog/feed/'].includes(feedPath) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return {allowed:false,code:'robots-unproven'};
  const groups=[];let current=null;
  const lines=text.split(/\r?\n/);
  if (lines.length>4096) return {allowed:false,code:'robots-unproven'};
  for (const raw of lines) {
    const line=raw.split('#',1)[0].trim();if (!line) continue;
    if (line.length>8192) return {allowed:false,code:'robots-unproven'};
    const match=/^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) return {allowed:false,code:'robots-unproven'};
    const directive=match[1].toLowerCase(),value=match[2].trim();
    if (directive==='sitemap') continue; // Non-access metadata; never followed or persisted.
    if (directive==='user-agent') {
      if (!/^(?:\*|[a-z0-9_-]+)$/i.test(value)) return {allowed:false,code:'robots-unproven'};
      if (!current || current.rules.length) { current={agents:[],rules:[]};groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else {
      if (!current) return {allowed:false,code:'robots-unproven'};
      current.rules.push({directive,value});
    }
  }
  const applicable=groups.filter(group=>group.agents.includes('*')||group.agents.includes(PRODUCT_TOKEN.toLowerCase()));
  if (!applicable.length) return {allowed:false,code:'robots-unproven'};
  let count=0,denied=false;
  for (const group of applicable) {
    if (!group.rules.length) return {allowed:false,code:'robots-unproven'};
    for (const rule of group.rules) {
      if (!['allow','disallow'].includes(rule.directive) || rule.value && (!rule.value.startsWith('/') || /[*$%\s]/.test(rule.value) || /[^\x21-\x7e]/.test(rule.value))) return {allowed:false,code:'robots-unproven'};
      count++;
      if (rule.directive==='disallow'&&rule.value&&feedPath.startsWith(rule.value)) denied=true;
    }
  }
  return !count ? {allowed:false,code:'robots-unproven'} : denied ? {allowed:false,code:'robots-disallowed'} : {allowed:true,code:'robots-allowed'};
}
export function createRequester({resolver=host=>dns.lookup(host,{all:true}),transport=pinnedRequest,dnsTimeoutMs=DEADLINE_MS}={}) {
  const requested=new Set();const stats={requests:0};
  async function request(url) {
    const endpoint=endpointMap.get(url);
    if (!endpoint || requested.has(url) || requested.size>=4) implementation();
    requested.add(url);
    let addresses;
    try { addresses=await bounded(Promise.resolve().then(()=>resolver(new URL(url).hostname)),dnsTimeoutMs,'dns-timeout'); }
    catch(error){if(error instanceof ProbeFailure) throw error;if(ordinaryError(error)&&networkCodes.has(error.code)) normal('dns-error');implementation();}
    if (!Array.isArray(addresses)||!addresses.length||addresses.length>64||addresses.some(address=>!address||!publicAddress(address.address)||net.isIP(address.address)!==address.family)) normal('dns-policy');
    stats.requests++;
    let response;
    try { response=await transport(url,{addresses,timeoutMs:DEADLINE_MS,maxBytes:endpoint.maxBytes,headers:{Accept:endpoint.kind==='robots'?'text/plain':'application/rss+xml, application/atom+xml, application/xml, text/xml','User-Agent':USER_AGENT,'Accept-Encoding':'identity'}}); }
    catch(error){if(ordinaryError(error)&&['timeout','transport-error','response-size'].includes(error.message)) normal(error.message);if(ordinaryError(error)&&networkCodes.has(error.code)) normal('transport-error');implementation();}
    if (!response||!Number.isInteger(response.status)||response.status<100||response.status>599||!response.headers||typeof response.headers!=='object'||!Buffer.isBuffer(response.body)) implementation();
    const status=response.status,bytes=response.body.length;
    if (bytes>endpoint.maxBytes) normal('response-size',status,bytes);
    if (status>=300&&status<=399) normal('redirect-unproven',status,bytes);
    if (status!==200) normal(status===403?'http-forbidden':status===429?'http-rate-limited':status>=500?'http-server-error':'http-status',status,bytes);
    const contentType=response.headers['content-type'];
    const type=typeof contentType==='string'?contentType.split(';')[0].trim().toLowerCase():'';
    if (endpoint.kind==='robots' ? type!=='text/plain' : !['application/rss+xml','application/atom+xml','application/xml','text/xml'].includes(type)) normal('content-type',status,bytes);
    if (response.headers['content-encoding']&&response.headers['content-encoding']!=='identity') normal('content-encoding',status,bytes);
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(response.body);}catch{normal('invalid-utf8',status,bytes);}
    return {status,bytes,text,bodyDigest:endpoint.kind==='feed'?digest(response.body):null};
  }
  return {request,stats};
}
const failureResult=error=>{if(!(error instanceof ProbeFailure)) implementation();return {status:'unproven',code:error.message,httpStatus:error.status,bytes:error.bytes,bodyDigest:null};};
export async function probe(requester,binding) {
  if (!requester||typeof requester.request!=='function'||!requester.stats) implementation();
  const results=[];
  for (const target of TARGETS) {
    let robots;
    try { robots=await requester.request(target.robotsUrl); }
    catch(error){results.push({sourceId:target.sourceId,robotsUrl:target.robotsUrl,feedUrl:target.feedUrl,robots:failureResult(error),feed:{status:'not-requested',code:'robots-unproven',httpStatus:null,bytes:0,bodyDigest:null}});continue;}
    const policy=robotsPolicy(robots.text,new URL(target.feedUrl).pathname);
    const robotsResult={status:policy.allowed?'allowed':'unproven',code:policy.code,httpStatus:robots.status,bytes:robots.bytes,bodyDigest:null};
    let feed={status:'not-requested',code:policy.code,httpStatus:null,bytes:0,bodyDigest:null};
    if (policy.allowed) {
      try { const response=await requester.request(target.feedUrl);feed={status:'response-validated',code:'http-200-bounded-response',httpStatus:response.status,bytes:response.bytes,bodyDigest:response.bodyDigest}; }
      catch(error){feed=failureResult(error);}
    }
    results.push({sourceId:target.sourceId,robotsUrl:target.robotsUrl,feedUrl:target.feedUrl,robots:robotsResult,feed});
  }
  return {version:1,publicationAuthorized:false,rawSourceBodyPersistedBytes:0,editorialCoverage:'NOT PROVEN',adapterReadiness:'NOT PROVEN',xmlValidity:'NOT PROVEN',run:binding,requests:requester.stats.requests,results};
}
export function expectedBinding(env,event,gitHead) {
  const pr=event?.pull_request;
  if (env.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_EVENT_NAME!=='pull_request'||env.GITHUB_WORKFLOW!=='Discovery Radar official feed probe'||env.GITHUB_WORKFLOW_REF!==`${REPOSITORY}/${WORKFLOW}@${env.GITHUB_REF}`||!/^refs\/pull\/[1-9][0-9]*\/merge$/.test(env.GITHUB_REF||'')||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID||'')||!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT||'')||!Number.isSafeInteger(Number(env.GITHUB_RUN_ATTEMPT))||!pr||pr.head?.repo?.full_name!==REPOSITORY||pr.base?.repo?.full_name!==REPOSITORY||pr.base?.ref!=='main'||!Number.isSafeInteger(pr.number)||pr.number<1||env.GITHUB_REF!==`refs/pull/${pr.number}/merge`||!/^[a-f0-9]{40}$/.test(pr.head?.sha||'')||env.PROBE_HEAD_SHA!==pr.head.sha||gitHead!==pr.head.sha) throw new Error('feed-probe-environment');
  return {repository:REPOSITORY,workflow:WORKFLOW,runId:env.GITHUB_RUN_ID,attempt:Number(env.GITHUB_RUN_ATTEMPT),pullRequest:pr.number,headSha:pr.head.sha,actionsSha:env.GITHUB_SHA};
}
export function summary(report) {
  const rows=report.results.map(result=>`| ${result.sourceId} | ${result.robots.code} | ${result.robots.httpStatus??'-'} | ${result.feed.code} | ${result.feed.httpStatus??'-'} | ${result.feed.bytes} | ${result.feed.bodyDigest??'-'} |`).join('\n');
  return `## Official feed bounded reachability probe\n\nRun ${report.run.runId}, attempt ${report.run.attempt}, PR ${report.run.pullRequest}, exact checked-out head ${report.run.headSha}. Actions merge-ref SHA: ${report.run.actionsSha}. GET requests: ${report.requests}/4.\n\n| Fixed source | Robots result | Robots HTTP | Feed result | Feed HTTP | Feed bytes | Feed digest |\n| --- | --- | ---: | --- | ---: | ---: | --- |\n${rows}\n\nHTTP 200 proves one bounded response in this run only. XML validity, adapter readiness, item completeness, editorial coverage, recall, terms review, and broader production readiness are **NOT PROVEN**. Publication is **not authorized**. No raw bodies, headers, titles, links, DNS addresses, or article metadata are persisted.\n`;
}
async function main(env) {
  if (!env.GITHUB_EVENT_PATH||!env.GITHUB_STEP_SUMMARY) throw new Error('feed-probe-environment');
  const stat=fs.lstatSync(env.GITHUB_EVENT_PATH);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024) throw new Error('feed-probe-environment');
  const event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(env.GITHUB_EVENT_PATH)));
  const gitHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const binding=expectedBinding(env,event,gitHead),report=await probe(createRequester(),binding);
  fs.appendFileSync(env.GITHUB_STEP_SUMMARY,summary(report),'utf8');
  console.log(canonical(report));
  if(report.results.some(result=>result.feed.status!=='response-validated')) console.log(WARNING);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{if(process.argv.length!==2) throw new Error('feed-probe-environment');await main(process.env);}
  catch{console.log(FAILURE);process.exitCode=1;}
}
