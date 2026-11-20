import assert from 'node:assert/strict';

// Entirely mocked Chrome/server: no real page or official submission is used.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const listeners = [], results = [];
const job = {job_id: 'live-submit-fixture', action: 'submit', problem: {id: 'leetcode-1', source: 'leetcode', url: 'https://leetcode.com/problems/two-sum/'}, code: 'fixture only', dry_run: false};
const stored = {bridge: {enabled: true, dryRun: false, pending: [job], completed: []}, bridgeConfig: {enabled: true, dryRun: false}};
let clicks = 0, polls = 0;
globalThis.chrome = {
  storage: {local: {
    async get(keys) {return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])]))},
    async set(values) {Object.assign(stored, structuredClone(values))}
  }},
  tabs: {
    async get(id) {return {id, windowId: 1, status: 'complete', url: job.problem.url};},
    async create() {return {id: 1, windowId: 1};}, async update(id) {return {id, windowId: 1};}, async query() {return [];}, async reload() {throw Error('Unexpected reload');}
  },
  windows: {async update() {}},
  scripting: {async executeScript({args: [action]}) {
    if (action === 'select_python') return [{result: {language: 'Python3'}}];
    if (action === 'fill_editor') return [{result: {filled: true, rows: []}}];
    if (action === 'click_submit') {clicks++; return [{result: {clicked: true, rows: []}}];}
    if (action === 'read_verdict') {
      if (!clicks) return [{result: {rows: [], current_run_id: null}}];
      polls++;
      const old = {run_id: '123', verdict: 'Accepted'};
      if (polls === 1) return [{result: {rows: [old], current_run_id: null}}];
      const fresh = {run_id: '456', verdict: polls === 2 ? 'Running' : 'Accepted'};
      return [{result: {rows: [old, fresh], current_run_id: '456'}}];
    }
    throw Error('Unexpected action: ' + action);
  }},
  runtime: {onInstalled: {addListener() {}}, onStartup: {addListener() {}}, onMessage: {addListener(fn) {listeners.push(fn)}}, reload() {throw Error('Unexpected extension reload')}},
  alarms: {async create() {}, onAlarm: {addListener() {}}}
};
globalThis.fetch = async (raw, options = {}) => {
  const path = new URL(raw).pathname;
  if (path === '/api/bridge/result') results.push(JSON.parse(options.body));
  return {ok: true, status: 200, async json() {return path === '/api/bridge/jobs' ? {jobs: []} : {ok: true};}};
};
await import('./background.js');
listeners[0]({type: 'tick'}, {}, () => {});
for (let i = 0; i < 60 && !stored.bridge.completed.includes(job.job_id); i++) await pause(100);
assert.equal(clicks, 1, 'a real-mode job clicks exactly once');
assert.ok(polls >= 3, 'late old history and a pending new run must not finish the job');
assert.equal(results.length, 1);
assert.equal(results[0].verdict, 'Accepted');
assert.equal(results[0].run_id, '456', 'only the report ID observed after Submit is accepted');
console.log('Mock official submit: one click, pending verdict and no stale Accepted checks passed.');
