// Run the real polling/bootstrap functions against isolated, delayed responses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
function between(start,end){
  const first=source.indexOf(start);assert.notEqual(first,-1,start);
  const last=source.indexOf(end,first);assert.notEqual(last,-1,end);
  return source.slice(first,last);
}
const functions=between('  function terminalJobsStamp(', '\n  async function queueImport(')+
  between('  async function loadData(', '\n  function initSplitters(');
const rowFunctions=between('  function officialVerdictTone(', '\n  function setDescriptionTab(');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function fixture(){
  const fields=new Map(),events={bootstraps:0,statusCalls:0,toasts:[],renders:[]};
  const $=id=>{if(!fields.has(id))fields.set(id,{value:'',innerHTML:'',checked:false});return fields.get(id);};
  const state={currentId:'A',view:'workspace',description:'submissions',pair:[],dirty:new Set(),draftWrites:new Map(),knownJobs:new Map(),appliedBridgeStamp:'[]',
    data:{problems:[{id:'A',title:'Task A',solved:false}],drafts:{A:{code:'local draft',notes:'local notes',status:'todo'}}}};
  let bootstrap={problems:[{id:'A',title:'Task A',solved:true}],topics:[],contests:[],drafts:{A:{status:'solved',solved:true,code:'server draft',notes:'server notes'}},
    progress:{solved:1},interview:{status:'running',results:[{problem_id:'A',solved:true}]},bridge:{jobs:[]}};
  let bridge={connected:true,jobs:[{job_id:'new',action:'submit',problem_id:'A',status:'complete',verdict:'Accepted',run_id:'123',updated_at:10}]};
  bootstrap.bridge=bridge;
  const sandbox={state,$,JSON,Date,Set,Map,Promise,console,
    current:()=>state.data.problems.find(p=>p.id===state.currentId),statusOf:p=>state.data.drafts[p.id]?.status||(p.solved?'solved':'todo'),draftOf:p=>state.data.drafts[p.id]||{},
    escape:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    briefBridgeMessage:value=>String(value??''),epoch:value=>Number(value)*1000,
    retryDirtyDrafts:async()=>{},toast:(...args)=>events.toasts.push(args),
    api:async path=>{if(path==='bridge/status'){events.statusCalls++;return structuredClone(bridge);}events.bootstraps++;return structuredClone(bootstrap);},
  };
  for(const name of ['renderProgress','renderCatalog','renderMap','renderBridge','renderInterview','renderProblem'])sandbox[name]=()=>events.renders.push(name);
  vm.createContext(sandbox);vm.runInContext(functions+rowFunctions,sandbox);
  return{state,events,$,sandbox,run:code=>vm.runInContext(code,sandbox),get bridge(){return bridge;},set bridge(value){bridge=value;bootstrap.bridge=value;},get bootstrap(){return bootstrap;}};
}

// A terminal job first seen in another tab still refreshes every progress surface.
{
  const f=fixture();await f.run('refreshBridge()');
  assert.equal(f.events.bootstraps,1);assert.equal(f.state.data.progress.solved,1);
  assert.equal(f.$('problem-status').value,'solved');assert.equal(f.state.interview.results[0].solved,true);
  assert.equal(f.state.data.drafts.A.code,'local draft');assert.equal(f.state.data.drafts.A.notes,'local notes');
  for(const name of ['renderProgress','renderCatalog','renderMap','renderInterview','renderProblem'])assert.ok(f.events.renders.includes(name),name);
  await f.run('refreshBridge()');assert.equal(f.events.bootstraps,1,'unchanged verdict must not reload every poll');
}

// A temporary bootstrap failure must be retried even when knownJobs already moved on.
{
  const f=fixture(),original=f.sandbox.api;let fail=true;
  f.sandbox.api=async path=>{if(path==='bootstrap'&&fail){f.events.bootstraps++;throw Error('temporary');}return original(path);};
  await f.run('refreshBridge()');assert.equal(f.state.appliedBridgeStamp,'[]');
  fail=false;await f.run('refreshBridge()');assert.equal(f.events.bootstraps,2);
  assert.equal(f.$('problem-status').value,'solved');assert.notEqual(f.state.appliedBridgeStamp,'[]');
}

// Concurrent interval/Submit refreshes share one request and bootstrap.
{
  const f=fixture(),wait=deferred(),original=f.sandbox.api;
  f.sandbox.api=async path=>{if(path==='bridge/status')await wait.promise;return original(path);};
  const a=f.run('refreshBridge()'),b=f.run('refreshBridge()');wait.resolve();await Promise.all([a,b]);
  assert.equal(f.events.statusCalls,1);assert.equal(f.events.bootstraps,1);
}

// History must show a judge rejection as failed even when transport completed normally.
{
  const f=fixture();f.state.bridge={jobs:[{job_id:'wa',action:'submit',problem_id:'A',status:'complete',verdict:'Wrong Answer',run_id:'124'}]};
  f.run('renderSubmissions()');assert.match(f.$('submissions-content').innerHTML,/submission-status failed/);
  assert.match(f.$('submissions-content').innerHTML,/Wrong Answer/);
  f.state.bridge.jobs[0].verdict='Accepted';f.run('renderSubmissions()');assert.match(f.$('submissions-content').innerHTML,/submission-status accepted/);
  f.state.bridge.jobs[0].dry_run=true;f.run('renderSubmissions()');assert.doesNotMatch(f.$('submissions-content').innerHTML,/submission-status accepted/);
}

// Ordering and heartbeats do not invalidate data; verdict details do.
{
  const f=fixture(),a={jobs:[{job_id:'a',status:'complete',updated_at:1},{job_id:'b',status:'error',updated_at:2}],last_seen:1};
  const b={...a,jobs:[...a.jobs].reverse(),last_seen:999};
  assert.equal(f.run(`terminalJobsStamp(${JSON.stringify(a)})`),f.run(`terminalJobsStamp(${JSON.stringify(b)})`));
  b.jobs[0]={...b.jobs[0],verdict:'Runtime Error'};
  assert.notEqual(f.run(`terminalJobsStamp(${JSON.stringify(a)})`),f.run(`terminalJobsStamp(${JSON.stringify(b)})`));
}

// A successful HTTP response may carry a real program error with useful output.
{
  const f=fixture(),body={status:'error',exit_code:1,error:'ZeroDivisionError',stdout:'before failure\n',stderr:'full traceback',duration:0.125};
  f.sandbox.fetch=async()=>({ok:true,status:200,json:async()=>body});
  f.run(between('  async function api(', '\n  let toastTimer'));
  assert.deepEqual(await f.run('api("run",{})'),body);
}

console.log('6 bridge/API regressions passed: first-seen verdict, retry, concurrency, rejection styling, stable stamps and execution errors.');
