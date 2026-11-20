import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the private tab helpers with isolated Chrome mocks and fast timers.
const source = (await fs.readFile(new URL('./background.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '');
let getter, creates = 0, queries = 0, reloads = 0, windowFocuses = 0;
const allowed = 'https://leetcode.com/problems/two-sum/';
const context = vm.createContext({
  URL, console, AbortSignal, Promise,
  setTimeout(fn) {queueMicrotask(fn); return 1;}, clearTimeout() {},
  allowedUrl: url => url.startsWith('https://leetcode.com/'),
  pageAction() {}, terminalVerdict() {}, freshRun() {},
  chrome: {
    tabs: {
      async get(id) {return getter(id);},
      async reload() {reloads++;},
      async query() {queries++; return [];},
      async create() {creates++; return {id: 22, windowId: 3};},
      async update(id) {return {id, windowId: 3};}
    },
    windows: {async update() {windowFocuses++;}},
    runtime: {onInstalled: {addListener() {}}, onStartup: {addListener() {}}, onMessage: {addListener() {}}},
    alarms: {onAlarm: {addListener() {}}}
  }
});
vm.runInContext(source + '\nglobalThis.helpers = {readyTab, ensureTab};', context);
const {readyTab, ensureTab} = context.helpers;

let reads = 0;
getter = id => ({id, status: 'complete', url: allowed, frozen: ++reads < 3});
await readyTab(11);
assert.equal(reloads, 1, 'a frozen tab is reloaded only once while recovery settles');
assert.equal(reads, 3);

reads = 0; reloads = 0;
getter = id => ({id, status: 'complete', url: 'chrome://newtab/'});
await assert.rejects(readyTab(11), /слишком долго/);
assert.equal(reloads, 0, 'a placeholder page is waited on, not accepted or reloaded');

reloads = 0;
getter = id => ({id, status: 'complete', url: allowed, frozen: true});
await assert.rejects(ensureTab({tabId: 11}, allowed, true), /слишком долго/);
assert.equal(reloads, 1);
assert.equal(creates, 0, 'readiness errors must not create a duplicate tab');
assert.equal(queries, 0);
assert.equal(windowFocuses, 1, 'submission focuses the actual browser window');

getter = id => {
  if (id === 11) throw Error('No tab with id 11');
  return {id, status: 'complete', url: allowed};
};
const job = {tabId: 11};
await ensureTab(job, allowed, false);
assert.equal(job.tabId, 22);
assert.equal(creates, 1, 'only an actually missing tab is replaced');
console.log('Tab recovery, allowed-page readiness, window focus and no-duplicate checks passed.');
