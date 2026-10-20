'use strict';
/* 把演示账号恢复到「可交互初始态」：撤回被测试点击过的建议反馈、删除测试产生的题目 */
const BASE = 'http://127.0.0.1:8899';
let cookie = '';
async function call(method, url, body) {
  const init = { method, headers: {} };
  if (cookie) init.headers.Cookie = cookie;
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(BASE + url, init);
  for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []))) { const m = /^sid=([^;]*)/.exec(c); if (m) cookie = 'sid=' + m[1]; }
  return { status: res.status, data: await res.json().catch(() => null) };
}
(async () => {
  await call('POST', '/api/auth/login', { username: 'demo', password: 'demo123456' });
  const sug = (await call('GET', '/api/suggestions/today')).data.suggestion;
  if (sug && sug.status !== '待响应') { await call('DELETE', '/api/suggestions/' + sug.id + '/feedback'); console.log('已撤回建议反馈'); }
  const hist = (await call('GET', '/api/solve/history?limit=20')).data.list;
  for (const q of hist) {
    if (/1\s*\+\s*1/.test(q.questionText || '')) { await call('DELETE', '/api/solve/' + q.id); console.log('已删除测试题目：' + q.questionText.slice(0, 24)); }
  }
  // 让今天至少留一件待做任务，便于演示「开始学习 / 暂时做不到 / 需要帮助」
  const today = (await call('GET', '/api/today')).data;
  const done = today.tasks.filter((t) => t.status === '已完成');
  if (done.length && today.tasks.filter((t) => t.status !== '已完成').length === 0) {
    const last = done[done.length - 1];
    await call('PATCH', '/api/tasks/' + last.id, { status: '待开始' });
    console.log('已把一件任务恢复为待开始，便于演示任务操作');
  }
  const t = (await call('GET', '/api/today')).data;
  console.log('今日状态：建议 ' + (t.suggestion ? t.suggestion.status : '无') + '，任务 ' + t.doneToday + '/' + t.tasks.length + ' 完成，开始学习按钮 ' + (t.tasks.some((x) => x.status !== '已完成') ? '可用' : '不可用'));
})();
