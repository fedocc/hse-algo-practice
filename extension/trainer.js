// The local page wakes the worker; no web page can choose a destination or source code here.
(() => {
  let interval;
  const tick = () => {
    try { chrome.runtime.sendMessage({type: 'tick'}).catch(() => {}); }
    catch { clearInterval(interval); }
  };
  tick();
  interval = setInterval(tick, 2000);
})();
