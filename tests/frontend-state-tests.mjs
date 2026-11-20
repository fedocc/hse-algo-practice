// Execute real frontend functions against delayed APIs, without a browser or user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
const between=(start,end)=>{
  const position=source.indexOf(start);assert.notEqual(position,-1,start);
  const finish=source.indexOf(end,position);assert.notEqual(finish,-1,end);
  return source.slice(position,finish);
};
const runFunction=between('  function casesFor(', '  function briefBridgeMessage(')+between('  async function runCode(', '\n  function renderResult(');
const debugFunctions=between('  function debugIsCurrent(', '\n  function renderDebug(');
const loadFunction=between('  async function loadData(', '\n  function initSplitters(');
const apiFunction=between('  async function api(', '\n  let toastTimer');
const saveFunctions=between('  async function saveDraft(', '\n  async function flushDraft(');
const bridgeFunction=between('  async function refreshBridge(', '\n  async function queueImport(');
const stampFunction=between('  function terminalJobsStamp(', '\n  async function refreshBridge(');
const resultFunction=between('  function renderResult(', '\n  async function judgeLocal(');
const statementFunction=between('  const statementReady =', '\n  const cleanTitle');
const randomBinding=between("$('random-problem').onclick=", ";$('bookmark-problem')");
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

function context(){
  const fields=new Map();
  const element=(id)=>{
    if(!fields.has(id))fields.set(id,{value:'',textContent:'',innerHTML:'',className:'',hidden:false,dataset:{},classList:{toggle(){},remove(){}}});
    return fields.get(id);
  };
  element('stdin-input').value='input A';element('expected-output').value='expected A';
  const state={currentId:'A',view:'workspace',running:false,debug:null,debugTimer:null,pair:[],breakpoints:new Map([['A',new Set([2])]]),dirty:new Set(),saves:new Map(),savedDrafts:new Map(),draftWrites:new Map(),knownJobs:new Map(),testCases:new Map(),testSelections:new Map(),runResults:new Map(),lastResultKind:new Map(),data:{problems:[{id:'A',title:'Problem A'},{id:'B',title:'Problem B'},{id:'C',title:'Problem C'}],drafts:{A:{code:'code A',notes:'notes A'},B:{code:'code B',notes:'notes B'}}}};
  const events={renders:[],debugRenders:[],toasts:[],bodies:[],timer:null};
  const sandbox={state,$:element,current:()=>state.data.problems.find(p=>p.id===state.currentId),codeValue:()=>state.data.drafts[state.currentId]?.code,
    statusOf:p=>state.data.drafts[p.id]?.status||(p.solved?'solved':'todo'),draftOf:p=>state.data.drafts[p.id]||{},
    flushDraft:async()=>{},api:async(path,body)=>{events.bodies.push({path,body});return{status:'finished',exit_code:0};},
    renderResult:(...args)=>events.renders.push(args),renderRunBatch:batch=>events.renders.push({problemId:batch.problem.id,expected:batch.cases[0].expected,complete:batch.complete}),caseVerdict:result=>({tone:result?.passed===false?'error':'success'}),renderDebug:()=>events.debugRenders.push(state.debug),toast:(...args)=>events.toasts.push(args),
    updateRunButtons(){},setConsoleTab(){},renderProgress(){},renderCatalog(){},renderMap(){},renderBridge(){},renderInterview(){},renderProblem(){},
    setTimeout:(callback)=>{events.timer=callback;return 1;},clearTimeout(){},encodeURIComponent,JSON,Set,Map};
  vm.createContext(sandbox);vm.runInContext(stampFunction,sandbox);return{sandbox,state,events,element,define:code=>vm.runInContext(code,sandbox)};
}

// A failed save in an inactive task must survive a later successful bootstrap.
{
  const c=context();c.state.currentId='B';c.state.dirty.add('A');c.state.data.drafts.A={code:'new unsaved code',notes:'new unsaved notes'};
  c.sandbox.api=async()=>({problems:c.state.data.problems,topics:[],contests:[],drafts:{A:{code:'old code',notes:'old notes',status:'todo'},B:{code:'server B',notes:'server notes'},C:{code:'fresh C',notes:'fresh C notes'}}});
  c.define(loadFunction);await c.define('loadData(false)');
  assert.equal(c.state.data.drafts.A.code,'new unsaved code');assert.equal(c.state.data.drafts.A.notes,'new unsaved notes');
  assert.equal(c.state.data.drafts.A.status,'todo');assert.equal(c.state.data.drafts.C.code,'fresh C');
}

// A save finishing while bootstrap is in flight must not expose its stale copy.
{
  const c=context(),reply=deferred();c.state.currentId='B';c.state.dirty.add('A');c.state.data.drafts.A={code:'new saved code',notes:'new saved notes'};
  c.sandbox.api=async()=>reply.promise;c.define(loadFunction);const loading=c.define('loadData(false)');
  c.state.dirty.delete('A');reply.resolve({problems:c.state.data.problems,topics:[],contests:[],drafts:{A:{code:'old code',notes:'old notes'},B:{code:'B',notes:''}}});await loading;
  assert.equal(c.state.data.drafts.A.code,'new saved code');assert.equal(c.state.data.drafts.A.notes,'new saved notes');
}

// A healthy status refresh retries an inactive draft after the server returns.
{
  const c=context();c.state.currentId='B';c.state.dirty.add('A');c.state.data.drafts.A={code:'unsaved A',notes:'unsaved note'};
  c.sandbox.api=async(path,body)=>{c.events.bodies.push({path,body});return path==='bridge/status'?{jobs:[]}:{};};
  c.define(saveFunctions+bridgeFunction);await c.define('refreshBridge()');
  const saved=c.events.bodies.find(call=>call.path==='draft');assert.equal(saved.body.problem_id,'A');assert.equal(saved.body.notes,'unsaved note');
  assert.equal(c.state.dirty.has('A'),false);assert.equal(c.state.draftWrites.size,0);
}

// Concurrent save/recovery requests serialize per task and drain the newest edit.
{
  const c=context(),first=deferred();c.state.dirty.add('A');c.state.data.drafts.A={code:'version 1',notes:'note 1'};
  c.sandbox.api=async(path,body)=>{c.events.bodies.push({path,body:{...body}});return c.events.bodies.length===1?first.promise:{};};c.define(saveFunctions);
  const saving=c.define('saveDraft({problem_id:"A",code:"version 1",notes:"note 1"})');await new Promise(setImmediate);
  c.state.data.drafts.A={code:'version 2',notes:'note 2'};const newer=c.define('saveDraft({problem_id:"A",code:"version 2",notes:"note 2"})');
  await c.define('retryDirtyDrafts()');assert.equal(c.events.bodies.length,1);first.resolve({});await Promise.all([saving,newer]);
  assert.equal(c.events.bodies.length,2);assert.equal(c.events.bodies[1].body.code,'version 2');assert.equal(c.events.bodies[1].body.notes,'note 2');
  assert.equal(c.state.savedDrafts.get('A').code,'version 2');assert.equal(c.state.dirty.has('A'),false);assert.equal(c.state.draftWrites.size,0);
}

// A failed POST remains dirty; a later successful health check saves newer notes.
{
  const c=context();c.state.dirty.add('A');let offline=true;
  c.sandbox.api=async(path,body)=>{c.events.bodies.push({path,body});if(path==='bridge/status')return{jobs:[]};if(offline)throw Error('Server unavailable');return{};};
  c.define(saveFunctions+bridgeFunction);await c.define('saveDraft({problem_id:"A",code:"code A",notes:"notes A"})');
  assert.equal(c.state.dirty.has('A'),true);assert.equal(c.element('save-status').textContent,'Not saved');
  c.state.data.drafts.A.notes='new notes while offline';offline=false;await c.define('refreshBridge()');
  assert.equal(c.state.dirty.has('A'),false);assert.equal(c.state.savedDrafts.get('A').notes,'new notes while offline');assert.equal(c.element('save-status').textContent,'Saved');
}

// A user switching tasks during autosave must not change the Run request.
{
  const c=context();c.define(runFunction);c.define('casesFor(); captureSelectedTest()');
  c.sandbox.flushDraft=async()=>{c.state.currentId='B';c.element('stdin-input').value='input B';c.element('expected-output').value='expected B';};
  await c.define('runCode()');
  assert.deepEqual({...c.events.bodies[0].body},{problem_id:'A',code:'code A',stdin:'input A',expected:'expected A'});
  assert.equal(c.events.renders.length,1);assert.equal(c.events.renders[0].complete,false);assert.equal(c.state.running,false);
}

// Changing the expected field after clicking Run must not change its displayed reference.
{
  const c=context();c.define(runFunction);c.define('casesFor(); captureSelectedTest()');c.sandbox.flushDraft=async()=>{c.element('expected-output').value='edited after click';};
  await c.define('runCode()');assert.equal(c.events.renders.at(-1).expected,'expected A');
}

// A late result is never rendered into another task, even after the request starts.
{
  const c=context(),reply=deferred();c.define(runFunction);c.define('casesFor(); captureSelectedTest()');c.sandbox.api=async()=>reply.promise;
  const running=c.define('runCode()');await Promise.resolve();c.state.currentId='B';reply.resolve({status:'ok',exit_code:0});await running;
  assert.equal(c.events.renders.length,1);assert.equal(c.events.renders[0].complete,false);assert.equal(c.state.running,false);
}

// Navigation during Debug start stops the returned orphan session.
{
  const c=context(),reply=deferred();c.define(debugFunctions);
  c.sandbox.api=async(path,body)=>{c.events.bodies.push({path,body});if(path==='debug/start')return reply.promise;return{status:'finished'};};
  const starting=c.define('startDebug()');await new Promise(setImmediate);
  assert.equal(c.events.bodies[0].path,'debug/start');c.state.currentId='B';reply.resolve({session_id:'old-A',status:'paused'});await starting;
  assert.equal(c.events.bodies[1].path,'debug/old-A/command');assert.equal(c.events.bodies[1].body.command,'stop');
  assert.equal(c.state.debug,null);assert.equal(c.events.debugRenders.length,0);assert.equal(c.state.running,false);
}

// A server restart removes old sessions; pressing Debug can start a fresh one.
{
  const c=context();c.define(debugFunctions);c.state.debug={session_id:'stale',status:'running'};
  c.sandbox.api=async(path)=>{if(path==='debug/stale/command')throw Object.assign(Error('Session not found'),{status:404});return{session_id:'fresh',status:'paused'};};
  await c.define('startDebug()');assert.equal(c.state.debug.session_id,'fresh');assert.equal(c.events.debugRenders.length,1);
}

// An in-flight command cannot reattach its result after navigation clears the session.
{
  const c=context(),reply=deferred();c.define(debugFunctions);c.state.debug={session_id:'A-session',status:'paused'};c.sandbox.api=async()=>reply.promise;
  const command=c.define('debugCommand("next")');c.state.currentId='B';c.state.debug=null;reply.resolve({session_id:'A-session',status:'paused'});await command;
  assert.equal(c.state.debug,null);assert.equal(c.events.debugRenders.length,0);
}

// The same guard applies to a delayed poll response.
{
  const c=context(),reply=deferred();c.define(debugFunctions);c.state.debug={session_id:'A-session',status:'running'};c.sandbox.api=async()=>reply.promise;
  c.define('pollDebug()');const polling=c.events.timer();c.state.currentId='B';c.state.debug=null;reply.resolve({session_id:'A-session',status:'paused'});await polling;
  assert.equal(c.state.debug,null);assert.equal(c.events.debugRenders.length,0);
}

// A dead session gets an actionable error rather than an endless Running label.
{
  const c=context();c.define(debugFunctions);c.state.debug={session_id:'gone',status:'running',line:2};
  c.sandbox.api=async()=>{throw Object.assign(Error('Session not found'),{status:404});};c.define('pollDebug()');await c.events.timer();
  assert.equal(c.state.debug.status,'error');assert.equal(c.state.debug.line,null);
}

// Keep the HTTP status for recovery code instead of parsing translated error text.
{
  const c=context();c.sandbox.fetch=async()=>({ok:false,status:404,json:async()=>({error:'Session not found'})});c.define(apiFunction);
  await assert.rejects(c.define('api("debug/gone")'),error=>error.status===404&&error.message==='Session not found');
}

// A nonzero exit may report only `error`, while a traceback already contains it.
{
  const c=context();c.sandbox.escape=value=>String(value);
  c.element('result-dot').classList={toggle(){}};c.element('result-summary').insertAdjacentHTML=()=>{};
  c.define(resultFunction);c.define('renderResult({status:"error",exit_code:2,error:"SystemExit: 2",stderr:""})');
  assert.match(c.element('result-body').innerHTML,/<h3>Ошибка<\/h3><pre>SystemExit: 2<\/pre>/);
  c.define('renderResult({status:"error",exit_code:1,error:"ZeroDivisionError: division by zero",stderr:"Traceback\\nZeroDivisionError: division by zero"})');
  assert.equal(c.element('result-body').innerHTML.split('ZeroDivisionError: division by zero').length-1,1);
  c.define('renderResult({status:"error",exit_code:2,error:"SystemExit: 2",stderr:"warning"})');
  assert.match(c.element('result-body').innerHTML,/<h3>stderr<\/h3><pre>warning<\/pre>/);
  assert.match(c.element('result-body').innerHTML,/<h3>Ошибка<\/h3><pre>SystemExit: 2<\/pre>/);
}

// Random never chooses a non-premium task whose condition did not import.
{
  const c=context(),selected=[];c.sandbox.isSolved=p=>!!p.solved;c.sandbox.priorityOf=p=>p.interview_priority!==false;
  c.sandbox.selectProblem=id=>selected.push(id);c.sandbox.Math={random:()=>0,floor:Math.floor};
  c.state.data.problems=[{id:'leetcode-1650',premium:false},{id:'leetcode-159',premium:false,statement_html:''},{id:'blank',statement_html:' \n\t'},{id:'partial',statement_html:'<p>Header only</p>',statement_incomplete:true}];
  c.define(statementFunction+randomBinding);c.element('random-problem').onclick();assert.equal(selected.length,0);
  c.state.data.problems.push({id:'image-task',statement_html:'<p><img src="/imported/statements/task.png"></p>'});
  c.element('random-problem').onclick();assert.deepEqual(selected,['image-task']);
}

console.log('16 frontend state regressions passed: dirty drafts/recovery, serialized saves, Run snapshots, navigation, Debug recovery, error detail and ready conditions.');
