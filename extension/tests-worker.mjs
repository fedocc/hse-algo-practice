import assert from 'node:assert/strict';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const events = [], results = [], listeners = [];
const contest = {id:'100',title:'Fixture contest',topicId:'graphs'};
const job = {job_id:'import-fixture',action:'import_contests',contests:[contest]};
const stored = {bridge:{enabled:true,dryRun:true,pending:[job],completed:[]},bridgeConfig:{enabled:true,dryRun:true}};
let offeredSubmit = false;
globalThis.chrome = {
  storage:{local:{async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(stored[key])]))},async set(values){Object.assign(stored,structuredClone(values))}}},
  tabs:{async get(id){return{id,status:'complete',url:'https://official.contest.yandex.ru/contest/100/problems/'}},async create(){return{id:1}},async update(id){return{id}},async query(){return[]},async reload(){}},
  scripting:{async executeScript({args:[action,payload]}){
    events.push(action);
    if(action==='read_yandex'){
      await pause(350);
      const letter=payload.url.match(/problems\/([A-Z])/i)?.[1]||'A';
      return[{result:{problem:{id:`yandex-100-${letter}`,title:letter,url:`https://official.contest.yandex.ru/contest/100/problems/${letter}/`},links:'ABCDEFGH'.split('').map(letter=>({url:`https://official.contest.yandex.ru/contest/100/problems/${letter}/`}))}}];
    }
    if(action==='fill_editor')return[{result:{filled:true,rows:[]}}];
    if(action==='read_verdict')return[{result:{rows:[]}}];
    if(action==='select_python')return[{result:{language:'Python 3'}}];
    throw Error('Unexpected page action '+action);
  }},
  runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(fn){listeners.push(fn)}},reload(){throw Error('Unexpected worker reload')}},
  alarms:{async create(){},onAlarm:{addListener(){}}}
};
globalThis.fetch=async(raw,options={})=>{
  const path=new URL(raw).pathname;
  let result={};
  if(path==='/api/bridge/jobs'){
    if(results.some(result=>result.problems?.length)&&!offeredSubmit){
      offeredSubmit=true;
      result={jobs:[{job_id:'urgent-submit',action:'submit',problem:{id:'p',source:'yandex',letter:'A',url:'https://official.contest.yandex.ru/contest/100/problems/A/'},code:'print(1)',dry_run:true}]};
    }else result={jobs:[]};
  }
  if(path==='/api/bridge/result'){
    const payload=JSON.parse(options.body); results.push(payload);
    if(payload.status==='complete')events.push('complete:'+payload.job_id);
  }
  return{ok:true,status:200,async json(){return result}};
};

await import('./background.js');
listeners[0]({type:'tick'},{},()=>{});
for(let index=0;index<100;index++){
  if(stored.bridge.completed.includes('import-fixture')&&stored.bridge.completed.includes('urgent-submit'))break;
  await pause(100);
}
assert.ok(stored.bridge.completed.includes('import-fixture'),'multi-task import completes without needing another UI tick');
assert.ok(stored.bridge.completed.includes('urgent-submit'),'new Submit is picked up during import');
assert.ok(events.indexOf('complete:urgent-submit')<events.indexOf('complete:import-fixture'),'Submit preempts bulk import');
assert.equal(events.includes('click_submit'),false,'dry-run never clicks Submit');
assert.equal(results.filter(result=>result.problems?.length).length,8,'all eight tasks imported');
assert.equal(new Set(results.flatMap(result=>result.problems||[]).map(problem=>problem.id)).size,8,'no duplicated imported tasks');
console.log('Worker batch continuation, Submit preemption, dry-run and eight-task import checks passed.');
