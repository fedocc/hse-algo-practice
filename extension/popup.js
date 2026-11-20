const $ = id => document.getElementById(id);
let state;
async function send(message) { return chrome.runtime.sendMessage(message); }
async function refresh() {
  state = await send({type: 'status'});
  $('status').textContent = state.message;
  $('connect').textContent = state.enabled ? 'Отключить' : 'Подключить';
  $('indicator').classList.toggle('on', state.enabled && !state.lastError);
  $('dry-run').checked = state.dryRun;
  $('error').textContent = state.lastError || '';
  $('import-courses').disabled = !state.enabled;
  $('import-leetcode').disabled = !state.enabled;
  const job = state.pending?.find(item => item.job_id === state.active_job_id) || state.pending?.[0];
  $('focus-import').disabled = !state.pending?.some(item => item.action.startsWith('import_') && item.tabId);
  if (state.lastInspection) $('inspection').textContent = JSON.stringify(state.lastInspection, null, 2);
  $('debug').textContent = JSON.stringify({worker: state.worker, last_tick: state.last_tick_at ? new Date(state.last_tick_at).toLocaleTimeString() : null,
    job: job ? {id: job.job_id, action: job.action, contest: job.contests?.[job.index]?.title, task: job.problemIndex,
      total: job.taskUrls?.length, step: job.step, step_age_seconds: job.step_started_at ? Math.round((Date.now()-job.step_started_at)/1000) : null,
      retries: job.retries || 0, imported: job.importedCount, errors: job.errors?.slice(-3)} : null}, null, 2);
}
$('resume').addEventListener('click', async () => { const reply = await send({type: 'resume'}); if (reply.error) $('error').textContent = reply.error; else await refresh(); });
$('focus-import').addEventListener('click', async () => {
  const reply = await send({type: 'focus_import'});
  if (reply.error) $('error').textContent = reply.error;
  else $('status').textContent = reply.message;
});
$('inspect-form').addEventListener('click', async () => {
  const reply = await send({type: 'inspect_form', url: $('statement-url').value.trim()});
  if (reply.error) $('error').textContent = reply.error;
  else { $('inspection').textContent = JSON.stringify(reply.inspection, null, 2); $('inspection-panel').open = true; }
});
$('inspect-statement').addEventListener('click', async () => {
  const reply = await send({type: 'inspect_statement', url: $('statement-url').value.trim()});
  if (reply.error) $('error').textContent = reply.error;
  else { $('inspection').textContent = JSON.stringify(reply.inspection, null, 2); $('inspection-panel').open = true; }
});
$('connect').addEventListener('click', async () => { await send({type: 'configure', enabled: !state.enabled}); await refresh(); });
$('dry-run').addEventListener('change', async () => { await send({type: 'configure', dryRun: $('dry-run').checked}); await refresh(); });
$('open').addEventListener('click', () => chrome.tabs.create({url: 'http://127.0.0.1:8765'}));
for (const [id, action] of [['import-courses', 'import_contests'], ['import-leetcode', 'import_leetcode']]) {
  $(id).addEventListener('click', async () => {
    $(id).disabled = true;
    const response = await send({type: 'import', action});
    if (response.error) $('error').textContent = response.error;
    await refresh();
  });
}
refresh().catch(error => { $('status').textContent = error.message; });
setInterval(() => refresh().catch(() => {}), 1500);
