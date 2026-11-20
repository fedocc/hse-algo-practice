import {pageAction} from './page-adapter.js';
import {allowedUrl, terminalVerdict, freshRun} from './utils.js';

const BASE = 'http://127.0.0.1:8765';
const INITIAL = {enabled: false, dryRun: true, pending: [], completed: [], message: 'Связь выключена', lastError: ''};
let working = false;
let workingSince = 0;
let liveStep = '';
let continuation = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, milliseconds, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const config = async () => {
  const stored = await chrome.storage.local.get(['bridge', 'bridgeConfig']);
  return {...INITIAL, ...stored.bridge, ...stored.bridgeConfig};
};
const save = state => chrome.storage.local.set({bridge: state});

async function api(path, body) {
  const response = await fetch(BASE + path, {method: body ? 'POST' : 'GET', headers: {'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000)});
  if (!response.ok) throw Error(`Локальный сервер: HTTP ${response.status}`);
  return bounded(response.json(), 12000, 'Локальный сервер не завершил ответ за 12 секунд.');
}

async function readyTab(id) {
  let recovered = false;
  for (let n = 0; n < 40; n++) {
    const tab = await chrome.tabs.get(id);
    if (tab.discarded || tab.frozen) {
      if (!recovered) { await chrome.tabs.reload(id); recovered = true; }
      await sleep(250); continue;
    }
    if (tab.status === 'complete' && tab.url && allowedUrl(tab.url)) return tab;
    await sleep(250);
  }
  throw Error('Страница слишком долго открывается в Dia.');
}

async function ensureTab(job, url, active = false, reuseOrigin = false) {
  if (!allowedUrl(url)) throw Error('Этот адрес не входит в разрешённые учебные сайты.');
  const activate = async id => {
    const tab = await chrome.tabs.update(id, {active: true, autoDiscardable: false});
    if (typeof tab.windowId === 'number') await chrome.windows.update(tab.windowId, {focused: true});
  };
  if (job.tabId) {
    let tab;
    try { tab = await chrome.tabs.get(job.tabId); }
    catch { delete job.tabId; }
    if (tab) {
      if (tab.url && (tab.url.replace(/\/$/, '') === url.replace(/\/$/, '') || (reuseOrigin && new URL(tab.url).origin === new URL(url).origin))) {
        if (active) await activate(tab.id);
        await readyTab(tab.id); return tab.id;
      }
      if (!active && tab.url && allowedUrl(tab.url)) {
        await chrome.tabs.update(tab.id, {url, active: false});
        await readyTab(tab.id); return tab.id;
      }
    }
  }
  // Imports get a dedicated background tab; submission uses the exact task tab when available.
  const tabs = active ? await chrome.tabs.query({}) : [];
  const existing = tabs.find(tab => tab.url?.replace(/\/$/, '') === url.replace(/\/$/, ''));
  const tab = existing ? await chrome.tabs.update(existing.id, {active}) : await chrome.tabs.create({url, active});
  job.tabId = tab.id;
  if (active) await activate(tab.id);
  if (!active) { try { await chrome.tabs.update(tab.id, {autoDiscardable: false}); } catch {} }
  await readyTab(tab.id);
  return tab.id;
}

async function page(tabId, action, payload = {}, main = false) {
  liveStep = action;
  const results = await bounded(chrome.scripting.executeScript({target: {tabId}, world: main ? 'MAIN' : 'ISOLATED', func: pageAction, args: [action, payload]}),
    25000, 'Страница Dia не отвечает за 25 секунд.');
  if (results[0]?.result?.__error) throw Error(`[${action}] ${results[0].result.__error.message}`);
  if (!results[0]?.result) throw Error(`[${action}] Страница не вернула ответ адаптеру (${results.map(result => `frame=${result.frameId}, result=${typeof result.result}, error=${result.error?.message || result.error || 'none'}`).join('; ')}).`);
  return results[0].result;
}

async function focusDiagnosticTab(tab) {
  await chrome.tabs.update(tab.id, {active: true, autoDiscardable: false});
  if (typeof tab.windowId === 'number') await chrome.windows.update(tab.windowId, {focused: true});
  await readyTab(tab.id);
}

async function recordDiagnosticError(error, action, url) {
  const diagnostic = {action, url: url || '', error: String(error?.message || error), at: new Date().toISOString()};
  const state = await config(); state.lastError = diagnostic.error; state.lastInspection = diagnostic; await save(state);
  try {
    const server = await api('/api/bridge/status');
    const failed = [...(server.jobs || [])].reverse().find(job => job.action === 'submit' && job.status === 'error');
    if (failed) await api('/api/bridge/result', {job_id: failed.job_id, status: 'error', message: 'DIAGNOSTIC_ERROR ' + JSON.stringify(diagnostic)});
  } catch {}
}

async function finish(state, job, result) {
  // Persist final payload before acknowledging, so a server disconnect never causes a second submission.
  job.finalResult = result;
  await save(state);
  await api('/api/bridge/result', {job_id: job.job_id, ...result});
  state.completed = [...state.completed.filter(id => id !== job.job_id), job.job_id].slice(-300);
  state.pending = state.pending.filter(item => item.job_id !== job.job_id);
  state.message = result.message || (result.status === 'error' ? 'Действие завершилось с ошибкой' : 'Готово');
  state.lastError = result.status === 'error' ? state.message : '';
  await save(state);
}

async function importContestStep(state, job) {
  if (!job.contests) job.contests = (await api('/api/bootstrap')).contests || [];
  job.index ??= 0; job.problemIndex ??= 0; job.importedCount ??= 0; job.errors ??= [];
  if (job.index >= job.contests.length) return finish(state, job, {status: job.errors.length ? 'error' : 'complete',
    message: `Импортировано задач: ${job.importedCount}. Контестов: ${job.contests.length}.` + (job.errors.length ? ` Ошибки: ${job.errors.join('; ')}` : '')});
  const contest = job.contests[job.index];
  const firstUrl = `https://official.contest.yandex.ru/contest/${contest.id}/problems/`;
  try {
    job.step = 'Открываю страницу'; job.step_started_at = Date.now(); await save(state);
    await ensureTab(job, firstUrl, false, true);
    const url = job.taskUrls ? job.taskUrls[job.problemIndex] : firstUrl;
    job.step = `Читаю ${url}`; job.step_started_at = Date.now(); await save(state);
    const data = await page(job.tabId, 'read_yandex', {url, contestId: contest.id, topicId: contest.topicId, fetch: true});
    if (!job.taskUrls) {
      job.taskUrls = [...new Set([data.problem.url, ...data.links.map(link => link.url)].map(url => url.replace(/\/$/, '') + '/'))].sort();
      // The first response may represent A even if the task list is not alphabetic.
      job.problemIndex = job.taskUrls.indexOf(data.problem.url);
      if (job.problemIndex < 0) job.problemIndex = 0;
    }
    await api('/api/bridge/result', {job_id: job.job_id, status: 'progress', contest_id: String(contest.id), problems: [data.problem],
      message: `${contest.title}: ${job.problemIndex + 1}/${job.taskUrls.length} — ${data.problem.title}`});
    job.importedCount++; job.problemIndex++; job.retries = 0;
    job.last_progress_at = Date.now(); job.step = 'Сохранено';
    state.message = `Импорт: ${contest.title}, ${job.problemIndex}/${job.taskUrls.length}`;
    if (job.problemIndex >= job.taskUrls.length) {
      await api('/api/bridge/result', {job_id: job.job_id, status: 'progress', contest_id: String(contest.id), import_status: job.contestHadErrors ? 'error' : 'complete', message: `${contest.title}: импорт завершён${job.contestHadErrors ? ', есть недоступные задачи' : ''}`});
      job.index++; job.problemIndex = 0; delete job.taskUrls; delete job.contestHadErrors;
    }
    await save(state);
  } catch (error) {
    job.retries = (job.retries || 0) + 1;
    job.step = error.message; job.step_started_at = Date.now();
    if (job.retries < 3) {
      state.message = `Повтор ${job.retries}/3: ${error.message}`;
      // A background document may be frozen. Reload it; on the second timeout reveal it once.
      if (job.tabId && /не отвечает|слишком долго|врем|timeout|timed out|aborted/i.test(error.message)) {
        try { if (job.retries === 2) await chrome.tabs.update(job.tabId, {active: true}); await chrome.tabs.reload(job.tabId); } catch { delete job.tabId; }
      }
      await save(state); return;
    }
    const message = `${contest.title}: ${error.message}`;
    await api('/api/bridge/result', {job_id: job.job_id, status: 'progress', contest_id: String(contest.id), import_status: 'error', message});
    job.errors.push(message); job.contestHadErrors = true;
    job.failedTasks ??= []; job.failedTasks.push({contest_id: String(contest.id), url: job.taskUrls?.[job.problemIndex] || firstUrl, message: error.message});
    job.retries = 0;
    if (job.taskUrls && job.problemIndex + 1 < job.taskUrls.length) job.problemIndex++;
    else { job.index++; job.problemIndex = 0; delete job.taskUrls; delete job.contestHadErrors; }
    state.message = message; await save(state);
  }
}

async function importLeetCodeStep(state, job) {
  if (!job.items) {
    const all = (await api('/api/bootstrap')).problems || [];
    job.items = job.urls?.length ? job.urls.map(url => all.find(p => p.url.replace(/\/$/, '') === url.replace(/\/$/, '')) || {url}) : all.filter(p => p.source === 'leetcode');
  }
  job.index ??= 0; job.errors ??= [];
  if (job.index >= job.items.length) return finish(state, job, {status: job.errors.length ? 'error' : 'complete',
    message: `LeetCode: обработано ${job.items.length}, ошибок ${job.errors.length}.` + (job.errors.length ? ` ${job.errors.join('; ')}` : '')});
  const problem = job.items[job.index];
  try {
    await ensureTab(job, problem.url, false);
    const data = await page(job.tabId, 'read_leetcode', {problemId: problem.id, externalId: problem.externalId, difficulty: problem.difficulty,
      topicIds: problem.topicIds, solved: problem.solved});
    await api('/api/bridge/result', {job_id: job.job_id, status: 'progress', problems: [data.problem], message: `LeetCode: ${data.problem.title}`});
    state.message = `LeetCode: ${job.index + 1}/${job.items.length}`;
  } catch (error) { job.errors.push(`${problem.title || problem.url}: ${error.message}`); state.message = error.message; }
  job.index++; await save(state);
}

async function submitStep(state, job) {
  const problem = job.problem;
  if (!problem?.url || typeof job.code !== 'string') throw Error('В запросе нет задачи или исходного кода.');
  job.phase ||= 'prepare';
  if (job.phase === 'prepare') {
    await ensureTab(job, problem.url, true);
    await page(job.tabId, 'select_python', {}, true);
    const fill = await page(job.tabId, 'fill_editor', {code: job.code}, true);
    const before = await page(job.tabId, 'read_verdict', {problemUrl: problem.url});
    job.baseline = [...new Set([...(fill.rows || []), ...(before.rows || [])].map(r => r.run_id))];
    job.baseline_current_run_id = before.current_run_id || null;
    job.phase = 'filled'; state.message = 'Python-код вставлен и проверен'; await save(state);
    if (state.dryRun || job.dry_run) return finish(state, job, {status: 'complete', dry_run: true, verdict: 'Filled',
      message: 'Код вставлен в Dia. Режим проверки: кнопка отправки не нажималась.'});
    return;
  }
  if (job.phase === 'filled') {
    const current = await config();
    if (!current.enabled) return;
    if (current.dryRun || job.dry_run) return finish(state, job, {status: 'complete', dry_run: true, verdict: 'Filled',
      message: 'Код вставлен в Dia. Режим проверки: кнопка отправки не нажималась.'});
    // Set before the click: if the worker disappears here, do not click again on restart.
    job.phase = 'awaiting'; job.clicked_at = Date.now(); await save(state);
    await page(job.tabId, 'click_submit', {jobId: job.job_id, code: job.code}, true);
    state.message = 'Решение отправлено, ожидаю новый вердикт'; await save(state); return;
  }
  if (job.phase === 'awaiting') {
    await readyTab(job.tabId);
    const response = await page(job.tabId, 'read_verdict', {problemUrl: problem.url});
    let run;
    if (problem.source === 'leetcode') {
      const currentId = response.current_run_id && String(response.current_run_id);
      if (!job.observed_run_id && currentId && currentId !== String(job.baseline_current_run_id || '') && !(job.baseline || []).map(String).includes(currentId)) job.observed_run_id = currentId;
      // A late-loaded history entry is not evidence that this click created a run.
      // Pin the new report URL first; only then follow that exact ID's verdict.
      run = job.observed_run_id && (response.rows || []).find(row => String(row.run_id) === String(job.observed_run_id));
    } else run = freshRun(response.rows || [], job.baseline || [], problem.letter);
    const verdict = run && terminalVerdict(run.verdict);
    if (verdict) return finish(state, job, {status: 'complete', verdict, run_id: String(run.run_id), message: `${problem.title}: ${verdict}`});
    const elapsed = Date.now() - job.clicked_at;
    if (elapsed > 120000) return finish(state, job, {status: 'error', run_id: run?.run_id,
      message: 'Не удалось получить новый итоговый вердикт за 2 минуты. Проверь посылки в Dia; повторной отправки не было.'});
    if (problem.source === 'yandex' && elapsed > 6000 && Date.now() - (job.reloaded_at || 0) > 8000) {
      await chrome.tabs.reload(job.tabId); job.reloaded_at = Date.now();
    }
    state.message = run ? `Проверяется посылка ${run.run_id}` : 'Ожидаю номер новой посылки'; await save(state);
  }
}

async function tick() {
  if (working) return;
  working = true; workingSince = Date.now();
  clearTimeout(continuation);
  try {
    const state = await config();
    if (!state.enabled) return;
    // A burst processes real work continuously; background-page timer throttling cannot reduce
    // the import to one problem per 30-second alarm. Checkpoint after every problem remains intact.
    for (let step = 0; step < 20 && Date.now() - workingSince < 45000; step++) {
      const currentSettings = (await chrome.storage.local.get('bridgeConfig')).bridgeConfig || {};
      if (currentSettings.enabled === false) break;
      state.enabled = currentSettings.enabled ?? state.enabled;
      state.dryRun = currentSettings.dryRun ?? state.dryRun;
      if (!state.pending.length || Date.now() - (state.last_claim_at || 0) > 1500) {
        liveStep = 'Получаю задания';
        const response = await api('/api/bridge/jobs');
        const known = new Set([...state.completed, ...state.pending.map(job => job.job_id)]);
        state.pending.push(...(response.jobs || []).filter(job => !known.has(job.job_id)));
        state.last_claim_at = Date.now();
        await save(state);
      } else await api('/api/bridge/heartbeat', {});
      // A user's Submit preempts bulk imports between pages. Judge polling leaves room for imports.
      const urgent = state.pending.find(item => item.action === 'submit' && (item.phase !== 'awaiting' || Date.now() - (item.last_verdict_poll || 0) >= 2000));
      const job = urgent || state.pending.find(item => item.action !== 'submit') || state.pending[0];
      state.active_job_id = job?.job_id || null;
      state.last_tick_at = Date.now();
      if (!job) {
        state.lastError = ''; state.message = 'Связь с локальным приложением установлена';
        await save(state); break;
      }
      try {
        if (job.finalResult) await finish(state, job, job.finalResult);
        else if (job.action === 'import_contests') await importContestStep(state, job);
        else if (job.action === 'import_leetcode') await importLeetCodeStep(state, job);
        else if (job.action === 'submit') { job.last_verdict_poll = Date.now(); await submitStep(state, job); }
        else await finish(state, job, {status: 'error', message: `Неизвестное действие: ${job.action}`});
        state.lastError = '';
      } catch (error) {
        if (/Локальный сервер|Failed to fetch|fetch|NetworkError/i.test(error.message)) throw error;
        await finish(state, job, {status: 'error', message: error.message});
      }
      // A submitted solution needs time on the official judge; never tight-loop/re-click it.
      if (job.action === 'submit' && job.phase === 'awaiting' && !job.finalResult && state.pending.length === 1) break;
      await sleep(100);
    }
  } catch (error) {
    const state = await config(); state.lastError = error.message;
    state.message = `Ожидаю повторного подключения: ${error.message}`; await save(state);
  } finally {
    working = false; workingSince = 0; liveStep = '';
    const state = await config();
    if (state.enabled && state.pending.length) continuation = setTimeout(tick, 500);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await config(); await save(state);
  await chrome.alarms.create('bridge-poll', {periodInMinutes: 0.5});
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('bridge-poll', {periodInMinutes: 0.5}));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'bridge-poll') tick(); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'tick') { tick(); respond({ok: true}); return; }
  if (message.type === 'status') { config().then(state => respond({...state, worker: {working, workingSince, step: liveStep}})); tick(); return true; }
  if (message.type === 'inspect_form') {
    (async () => {
      try {
        const state = await config();
        const server = await api('/api/bridge/status');
        const failedSubmit = [...(server.jobs || [])].reverse().find(job => job.action === 'submit' && job.status === 'error');
        let targetUrl = String(message.url || '').trim() || failedSubmit?.problem?.url;
        if (!targetUrl && failedSubmit?.problem_id) {
          const catalog = await api('/api/bootstrap');
          targetUrl = catalog.problems.find(problem => problem.id === failedSubmit.problem_id)?.url;
        }
        const tabs = await chrome.tabs.query({});
        const allowed = tabs.filter(tab => tab.url && allowedUrl(tab.url));
        let tab;
        if (targetUrl) {
          if (!allowedUrl(targetUrl)) throw Error('Нужен адрес задачи Контеста или LeetCode.');
          tab = allowed.find(tab => tab.url.replace(/\/$/, '') === targetUrl.replace(/\/$/, ''));
          if (!tab) { const temp = {}; const tabId = await ensureTab(temp, targetUrl, true); tab = await chrome.tabs.get(tabId); }
        } else tab = allowed.find(tab => tab.active) || allowed.at(-1);
        if (!tab) throw Error('Укажи адрес задачи в поле проверки условия.');
        await focusDiagnosticTab(tab);
        const inspection = await page(tab.id, 'inspect_form', {}, true);
        state.lastInspection = inspection; await save(state);
        // Explicit diagnostic action; store only form metadata (never editor contents) on localhost.
        if (failedSubmit) {
          await api('/api/bridge/result', {job_id: failedSubmit.job_id, status: 'error', message: 'DIAGNOSTIC ' + JSON.stringify(inspection)});
          state.diagnostic_job_id = failedSubmit.job_id; await save(state);
        }
        respond({ok: true, inspection});
      } catch (error) { await recordDiagnosticError(error, 'inspect_form', message.url); respond({error: error.message}); }
    })(); return true;
  }
  if (message.type === 'inspect_statement') {
    (async () => {
      try {
        const state = await config();
        const tabs = await chrome.tabs.query({});
        const allowed = tabs.filter(tab => tab.url?.startsWith('https://official.contest.yandex.ru/contest/'));
        const tab = allowed.find(tab => tab.active) || allowed.at(-1);
        if (!tab) throw Error('Открой любую задачу Яндекс Контеста в Dia.');
        const url = message.url || tab.url;
        if (!allowedUrl(url) || !url.startsWith('https://official.contest.yandex.ru/contest/')) throw Error('Нужна ссылка на задачу Яндекс Контеста.');
        await focusDiagnosticTab(tab);
        const inspection = await page(tab.id, 'inspect_statement', {url, fetch: true});
        state.lastInspection = inspection; await save(state);
        const server = await api('/api/bridge/status');
        const failedSubmit = [...(server.jobs || [])].reverse().find(job => job.action === 'submit' && job.status === 'error');
        if (failedSubmit) await api('/api/bridge/result', {job_id: failedSubmit.job_id, status: 'error', message: 'STATEMENT_DIAGNOSTIC ' + JSON.stringify(inspection)});
        respond({ok: true, inspection});
      } catch (error) { await recordDiagnosticError(error, 'inspect_statement', message.url); respond({error: error.message}); }
    })(); return true;
  }
  if (message.type === 'focus_import') {
    config().then(async state => {
      const job = state.pending.find(item => item.job_id === state.active_job_id && item.action.startsWith('import_') && item.tabId)
        || state.pending.find(item => item.action.startsWith('import_') && item.tabId);
      if (!job) { respond({error: 'Сейчас нет открытой страницы импорта.'}); return; }
      try {
        const tab = await chrome.tabs.get(job.tabId);
        await chrome.tabs.update(tab.id, {active: true, autoDiscardable: false});
        if (typeof tab.windowId === 'number') await chrome.windows.update(tab.windowId, {focused: true});
        respond({ok: true, tab_id: tab.id, message: 'Страница импорта открыта. Оставь её на переднем плане до завершения загрузки.'});
        tick();
      } catch (error) { respond({error: error.message}); }
    }); return true;
  }
  if (message.type === 'resume') {
    if (working && Date.now() - workingSince > 90000) {
      config().then(state => {
        const active = state.pending.find(job => job.job_id === state.active_job_id) || state.pending[0];
        if (active?.action === 'submit') { respond({error: 'Ожидается отправка. Перезапуск остановлен, чтобы не продублировать посылку.'}); return; }
        respond({restarting: true}); setTimeout(() => chrome.runtime.reload(), 100);
      }); return true;
    }
    tick(); respond({ok: true}); return;
  }
  if (message.type === 'configure') {
    config().then(async state => {
      if (typeof message.enabled === 'boolean') state.enabled = message.enabled;
      if (typeof message.dryRun === 'boolean') state.dryRun = message.dryRun;
      await chrome.storage.local.set({bridgeConfig: {enabled: state.enabled, dryRun: state.dryRun}});
      respond(state); if (state.enabled) tick();
    }); return true;
  }
  if (message.type === 'import') {
    api('/api/bridge/queue', {action: message.action}).then(result => { respond(result); tick(); }).catch(error => respond({error: error.message})); return true;
  }
});
