export function allowedUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ((u.hostname === 'official.contest.yandex.ru' && /^\/contest\/\d+\//.test(u.pathname)) || u.hostname === 'leetcode.com');
  } catch { return false; }
}

export function problemIdentity(raw) {
  const u = new URL(raw);
  const y = u.pathname.match(/^\/contest\/(\d+)\/problems\/([^/]+)\/?/);
  if (u.hostname === 'official.contest.yandex.ru' && y) return {source: 'yandex', contestId: y[1], letter: decodeURIComponent(y[2]), id: `yandex-${y[1]}-${decodeURIComponent(y[2])}`};
  const l = u.pathname.match(/^\/problems\/([^/]+)/);
  if (u.hostname === 'leetcode.com' && l) return {source: 'leetcode', slug: l[1]};
  return null;
}

export function terminalVerdict(text) {
  const t = String(text || '').trim();
  if (/^(OK|Accepted|Полное решение)$/i.test(t)) return 'Accepted';
  if (/wrong answer|неверный ответ|^WA$/i.test(t)) return 'Wrong Answer';
  if (/time limit|превышен.*врем|TL$/i.test(t)) return 'Time Limit Exceeded';
  if (/memory limit|превышен.*памят|ML$/i.test(t)) return 'Memory Limit Exceeded';
  if (/runtime error|ошибка.*выполн|RE$/i.test(t)) return 'Runtime Error';
  if (/compilation error|ошибка.*компиля|CE$/i.test(t)) return 'Compilation Error';
  if (/presentation error|ошибка.*формат|PE$/i.test(t)) return 'Presentation Error';
  if (/output limit|превышен.*вывод|OL$/i.test(t)) return 'Output Limit Exceeded';
  if (/security violation|нарушение.*безопас|SV$/i.test(t)) return 'Security Violation';
  if (/Idleness limit/i.test(t)) return 'Idleness Limit Exceeded';
  return null;
}

export function freshRun(rows, baseline, letter) {
  const old = new Set(baseline.map(String));
  return rows.filter(r => !old.has(String(r.run_id)) && (!letter || r.letter === letter))
    .sort((a, b) => Number(b.run_id) - Number(a.run_id))[0] || null;
}
