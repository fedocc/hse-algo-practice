// Exercise the shipped result renderer and Run flow without a browser or user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);};
const helpers=between('  function casesFor(', '  function briefBridgeMessage(');
const runner=between('  async function runCode(', '\n  function renderResult(');
const renderer=between('  function renderResult(', '\n  async function judgeLocal(');
const localRenderer=between('  function renderJudgeResult(', '\n  async function loadJudgeFailure(');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(){
  const fields=new Map(),events={calls:[],toasts:[],rendered:[]};
  const $=id=>{if(!fields.has(id))fields.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,className:'',dataset:{},classList:{toggle(){},remove(){}},querySelectorAll:()=>[]});return fields.get(id);};
  const p={id:'A',title:'Two Sum',source:'leetcode',signature:{params:['nums','target']},examples:[{input:'nums = [2,7,11,15], target = 9',output:'[0,1]'},{input:'nums = [3,2,4], target = 6',output:'[1,2]'},{input:'nums = [3,3], target = 6',output:'[0,1]'}]};
  const state={currentId:'A',data:{problems:[p],drafts:{A:{code:'snapshot code'}}},running:false,testCases:new Map(),testSelections:new Map(),runResults:new Map(),lastResultKind:new Map(),judgeResults:new Map()};
  const sandbox={state,$,current:()=>state.data.problems.find(v=>v.id===state.currentId),escape,icon:()=>'<svg></svg>',inputValue:v=>typeof v==='string'?v:JSON.stringify(v),localTestCount:()=>100,isSolved:()=>false,testProvenanceDetails:()=>'<details>source</details>',codeValue:()=>state.data.drafts.A.code,flushDraft:async()=>{},updateRunButtons(){},setConsoleTab(){},toast:(...args)=>events.toasts.push(args),api:async(path,body)=>{events.calls.push({path,body});return{status:'ok',exit_code:0,passed:true,return_value:[0,1],duration:.001};},JSON,Set,Map};
  vm.createContext(sandbox);const run=code=>vm.runInContext(code,sandbox);run(helpers+runner+renderer+localRenderer);run('renderExamples()');return{sandbox,state,events,$,run,p};
}
// Run dispatches every configured case using the click-time source/input snapshot.
{
  const c=fixture();c.sandbox.flushDraft=async()=>{c.state.data.drafts.A.code='later code';c.$('stdin-input').value='later input';c.$('expected-output').value='later expected';};
  c.sandbox.api=async(path,body)=>{c.events.calls.push({path,body});return{status:'ok',exit_code:0,passed:body.stdin.includes('[3,3]'),return_value:body.stdin.includes('[3,3]')?[0,1]:[-1,0],duration:.001};};
  await c.run('runCode()');assert.equal(c.events.calls.length,3);assert(c.events.calls.every(v=>v.body.code==='snapshot code'));assert.equal(c.events.calls[0].body.stdin,c.p.examples[0].input);assert.equal(c.events.calls[0].body.expected,'[0,1]');
  const b=c.state.runResults.get('A');assert.equal(b.selected,0);assert(b.complete);assert.equal(c.state.running,false);assert.match(c.$('result-summary').innerHTML,/Wrong Answer/);assert.match(c.$('result-body').innerHTML,/Case 3 · Accepted/);assert.match(c.$('result-body').innerHTML,/result-diff-actual">-1/);assert.match(c.$('result-body').innerHTML,/result-diff-expected">1/);assert.match(c.$('result-body').innerHTML,/локальные примеры: 3/);
  assert.equal(c.state.data.drafts.A.status,undefined);assert.equal(c.events.calls.filter(v=>v.path==='progress').length,0);
}
// Switching result cases uses that run's immutable input/output, not edited test fields.
{
  const c=fixture();await c.run('runCode()');c.$('stdin-input').value='changed after Run';c.run('selectResultCase(1)');
  const html=c.$('result-body').innerHTML;assert.match(html,/>target =<\/span><pre>6<\/pre>/);assert.match(html,/\[3,2,4\]/);assert.match(html,/<h3>Expected<\/h3><pre>\[1,2\]<\/pre>/);assert.doesNotMatch(html,/changed after Run/);assert.match(c.$('result-summary').innerHTML,/Accepted/);
}
// Diff is actually switchable; output stays compact and escaping remains intact.
{
  const c=fixture();c.sandbox.api=async()=>({status:'ok',exit_code:0,passed:false,return_value:[-1,0]});await c.run('runCode()');c.run('toggleResultDiff()');assert.doesNotMatch(c.$('result-body').innerHTML,/class="result-diff-actual"/);assert.match(c.$('result-body').innerHTML,/<pre>\[-1,0\]<\/pre>/);
  c.run('toggleResultDiff()');assert.match(c.$('result-body').innerHTML,/class="result-diff-actual"/);
  const text=c.run('diffMarkup("<img src=x onerror=alert(1)>", "safe", "actual")');assert.doesNotMatch(text,/<img/);assert.match(text,/&lt;/);
}
// Edits stay attached to the selected test, and + adds an independently editable case.
{
  const c=fixture();c.$('stdin-input').value='nums = [7,2], target = 9';c.$('expected-output').value='[1,0]';c.run('captureSelectedTest(); selectExample("1"); selectExample("0")');assert.equal(c.$('stdin-input').value,'nums = [7,2], target = 9');assert.equal(c.$('expected-output').value,'[1,0]');
  c.run('addTestCase()');assert.equal(c.state.testCases.get('A').length,4);c.$('stdin-input').value='nums = [1,2], target = 3';c.run('captureSelectedTest(); selectExample("0")');assert.equal(c.$('stdin-input').value,'nums = [7,2], target = 9');c.run('selectExample("3")');assert.equal(c.$('stdin-input').value,'nums = [1,2], target = 3');
}
// Navigation while a request is pending stores the old result but never renders into B.
{
  const c=fixture();let resolve;const pending=new Promise(done=>{resolve=done;});c.sandbox.api=async()=>pending;let renders=0;c.sandbox.renderRunBatch=()=>{renders++;};
  const work=c.run('runCode()');await Promise.resolve();c.state.currentId='B';resolve({status:'ok',exit_code:0,passed:true});await work;assert.equal(renders,1);assert.equal(c.state.running,false);assert(c.state.runResults.get('A').complete);assert.equal(c.events.toasts.length,1);
}
// Runtime failure is not called Wrong Answer; missing/semantic expected stays neutral.
{
  const c=fixture();assert.equal(c.run('caseVerdict({status:"finished",exit_code:2}).label'),'Runtime Error');assert.equal(c.run('caseVerdict({status:"timeout"}).label'),'Time Limit Exceeded');assert.equal(c.run('caseVerdict({status:"ok",exit_code:0}).label'),'Finished');assert.equal(c.run('caseVerdict({status:"ok",exit_code:0,comparison:"manual"}).label'),'Needs Review');
  c.run('renderResult({status:"error",exit_code:2,error:"SystemExit: 2",stderr:""})');assert.match(c.$('result-body').innerHTML,/SystemExit: 2/);
  c.run('renderResult({status:"error",exit_code:1,error:"division by zero",stderr:"Traceback\\ndivision by zero"})');assert.equal(c.$('result-body').innerHTML.split('division by zero').length-1,1);
  c.sandbox.api=async()=>({status:'error',exit_code:1,passed:false,error:'division by zero',stdout:'before failure'});
  await c.run('runCode()');assert.match(c.$('result-summary').innerHTML,/Runtime Error/);assert.doesNotMatch(c.$('result-summary').innerHTML,/data-result-diff/);assert.doesNotMatch(c.$('result-body').innerHTML,/result-diff-actual/);
}
// Zero, false, null, empty array and debug prints survive compact rendering.
{
  const c=fixture();for(const value of [0,false,null,[],'']){c.sandbox.value=value;c.run('renderResult({status:"ok",exit_code:0,return_value:value,stdout:"debug info"}, "")');const html=c.$('result-body').innerHTML;assert.match(html,/<h3>Stdout<\/h3>/);assert(html.includes(escape(JSON.stringify(value))));}
  c.run('renderResult({status:"ok",exit_code:0,return_value:0,mutated_prefix:[1,2]}, "0")');assert.match(c.$('result-body').innerHTML,/Modified input/);assert.match(c.$('result-body').innerHTML,/<pre>0<\/pre>/);
  assert.equal(c.run('resultText("x".repeat(20000)).length'),12002);
}
// Full local judges retain their manual-credit and provenance contract.
{
  const c=fixture();c.run('renderJudgeResult({verdict:"LOCAL_OK",passed_count:100,total:100,attempted_count:100,duration_ms:12},current())');assert.match(c.$('result-summary').innerHTML,/LOCAL · Accepted/);assert.equal(c.$('result-summary').dataset.source,'local');assert.match(c.$('result-body').innerHTML,/data-complete-local="A"/);assert.match(c.$('result-body').innerHTML,/source/);
  c.run('renderJudgeResult({verdict:"WRONG_ANSWER",passed_count:90,total:100,first_failure:{case_index:2,input:"1 2",expected:"3",actual:"4"}},current())');const html=c.$('result-body').innerHTML;assert.match(html,/data-load-judge-failure="A"/);assert(html.indexOf('<h3>Output')<html.indexOf('<h3>Expected'));assert.match(html,/result-diff-actual/);
}
console.log('8 frontend result groups passed: all cases, snapshot, switching, diff, custom tests, errors, values, local provenance.');
