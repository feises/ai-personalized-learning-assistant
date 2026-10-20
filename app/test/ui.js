'use strict';
/* 真实浏览器验证：通过 CDP 驱动 Edge 无头模式，检查各页面渲染、控制台报错并截图。
   用法：node test/ui.js <baseUrl> <username> <password> */
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const USER = process.argv[3];
const PASS = process.argv[4];
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['login', '/#/login', '登录页'],
  ['onboarding', '/#/onboarding', '首次填写'],
  ['today', '/#/today', '今日'],
  ['docs', '/#/docs', '学习资料分析'],
  ['solve', '/#/solve', 'AI 搜题'],
  ['solve-stats', '/#/solve/stats', '搜题统计'],
  ['solve-history', '/#/solve/history', '搜题历史'],
  ['resources', '/#/resources', '资源搜索推送'],
  ['me', '/#/me', '我的'],
  ['me-profile', '/#/me/profile', '基本信息'],
  ['me-goals', '/#/me/goals', '目标与时间'],
  ['me-entity', '/#/me/entity', '院校专业资料'],
  ['me-selfreport', '/#/me/selfreport', '我的学习情况'],
  ['docs-legacy', '/#/me/docs', '旧地址兼容'],
  ['me-growth', '/#/me/growth', '成长记录'],
  ['me-library', '/#/me/library', '资源库'],
  ['me-suggestions', '/#/me/suggestions', '建议记录'],
  ['me-privacy', '/#/me/privacy', '数据与隐私'],
  ['mobile-today', '/#/today', '今日（窄屏）', 420],
  ['mobile-solve', '/#/solve', '搜题（窄屏）', 420]
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpConnect() {
  const res = await fetch('http://127.0.0.1:9222/json/list');
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的浏览器页面，请确认 Edge 已用 --remote-debugging-port=9222 启动');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    events.push(msg);
  };
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  return { ws, send, events };
}

(async () => {
  const { ws, send, events } = await cdpConnect();
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Network.enable');
  // 从干净状态开始：清缓存与登录状态，否则可能被上一次测试的会话直接带进内页
  await send('Network.clearBrowserCache');
  await send('Network.clearBrowserCookies');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  const problems = [];
  function drain(tag) {
    for (const e of events.splice(0)) {
      if (e.method === 'Runtime.exceptionThrown') {
        const d = e.params.exceptionDetails;
        problems.push(tag + ' 异常：' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
      } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
        problems.push(tag + ' console.error：' + e.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
      } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
        problems.push(tag + ' 资源错误：' + e.params.entry.text.slice(0, 200));
      }
    }
  }
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // 1) 打开首页并登录（带缓存破坏参数，确保加载最新前端）
  await send('Page.navigate', { url: BASE + '/?cb=' + Date.now() + '#/login' });
  await sleep(2200);
  drain('登录页加载');
  const loginLayout = await evalJs(`(() => { const c = document.querySelector('.auth-card'); const app = document.getElementById('app'); return JSON.stringify({ card: !!c, appHidden: app ? getComputedStyle(app).display === 'none' : null }); })()`);
  console.log('登录页布局 -> ' + loginLayout);
  if (!/\"card\":true/.test(loginLayout) || !/\"appHidden\":true/.test(loginLayout)) problems.push('登录页布局异常：' + loginLayout);

  // 登录框不带输入提示；密码框的显示/隐藏按钮可切换
  const loginForm = await evalJs(`(() => {
    const inputs = Array.from(document.querySelectorAll('.auth-card input')).map((i) => ({ id: i.id, type: i.type, ph: i.getAttribute('placeholder') }));
    const pwd = document.querySelector('#p'); const btn = document.querySelector('#pwToggle');
    const before = { type: pwd.type, label: btn ? btn.getAttribute('aria-label') : null };
    if (btn) btn.click();
    const shown = { type: pwd.type, label: btn ? btn.getAttribute('aria-label') : null };
    if (btn) btn.click();
    const restored = { type: pwd.type };
    return JSON.stringify({ inputs, before, shown, restored });
  })()`);
  console.log('登录框 -> ' + loginForm);
  try {
    const f = JSON.parse(loginForm);
    if (f.inputs.some((i) => i.ph)) problems.push('登录输入框仍有占位提示：' + loginForm);
    if (!f.inputs.some((i) => i.id === 'p' && i.type === 'password')) problems.push('密码框初始应为隐藏状态：' + loginForm);
    if (f.shown.type !== 'text' || f.shown.label !== '隐藏密码') problems.push('密码显示切换无效：' + loginForm);
    if (f.restored.type !== 'password') problems.push('密码再次点击未恢复隐藏：' + loginForm);
  } catch (e) { problems.push('登录框检查异常：' + loginForm); }
  let r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, '01-login.png'), Buffer.from(r.result.data, 'base64'));

  const logged = await evalJs(`(async () => {
    const res = await fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:${JSON.stringify(USER)},password:${JSON.stringify(PASS)}})});
    return res.status;
  })()`);
  if (logged !== 200) { problems.push('登录失败，HTTP ' + logged); }
  await send('Page.navigate', { url: BASE + '/?cb=' + Date.now() + '#/today' });
  await sleep(3000);
  drain('登录后跳转');

  // 2) 逐页检查
  for (const [name, hash, label, width] of PAGES) {
    if (name === 'login') continue;
    await send('Emulation.setDeviceMetricsOverride', { width: width || 1280, height: width ? 780 : 900, deviceScaleFactor: 1, mobile: !!width });
    await evalJs(`location.hash = ${JSON.stringify(hash.replace(/^\/#/, '#'))}`);
    await sleep(name.startsWith('me-') || name.startsWith('solve') ? 1600 : 2600);
    drain(label);
    const info = await evalJs(`(() => {
      const main = document.getElementById('main');
      const txt = main ? main.innerText.replace(/\\s+/g,' ').trim() : '';
      return { len: txt.length, head: txt.slice(0, 90), hasMain: !!main, cards: main ? main.querySelectorAll('.card').length : 0, buttons: main ? main.querySelectorAll('button').length : 0 };
    })()`);
    if (!info || !info.hasMain || info.len < 20) problems.push(label + ' 页面内容为空（len=' + (info && info.len) + '）');
    if (info && /出了点问题/.test(info.head)) problems.push(label + ' 渲染出错：' + info.head);
    console.log('PAGE ' + label + ' -> 文本 ' + (info ? info.len : 0) + ' 字，卡片 ' + (info ? info.cards : 0) + '，按钮 ' + (info ? info.buttons : 0) + ' | ' + (info ? info.head : ''));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + (width ? '-mobile' : '') + '.png'), Buffer.from(shot.result.data, 'base64'));
  }

  // 3) 交互冒烟：搜题页输入并提交（真调模型）
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await evalJs(`location.hash = '#/solve'`);
  await sleep(1500);
  const askResult = await evalJs(`(async () => {
    const ta = document.querySelector('#q');
    if (!ta) return 'no-textarea';
    ta.value = '求 1+1 等于多少？并说明理由。';
    ta.dispatchEvent(new Event('input'));
    document.querySelector('#ask').click();
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      await new Promise(r => setTimeout(r, 800));
      const ans = document.querySelector('#answerArea');
      if (ans && ans.innerText.includes('逐步推导')) return 'ok';
      const btn = document.querySelector('#ask');
      if (btn && !btn.disabled && ans && ans.innerText.includes('没有生成')) return 'degraded';
    }
    return 'timeout';
  })()`);
  console.log('搜题交互 -> ' + askResult);
  if (askResult !== 'ok') problems.push('搜题页提交未得到完整解答（' + askResult + '）');
  drain('搜题提交');
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, '20-solve-result.png'), Buffer.from(shot.result.data, 'base64'));

  // 4) 今日页点「已经学了」
  await evalJs(`location.hash = '#/today'`);
  await sleep(2500);
  const todayClick = await evalJs(`(async () => {
    const b = document.querySelector('#sfb [data-f="done"]');
    if (!b) return 'no-button';
    b.click();
    await new Promise(r => setTimeout(r, 2500));
    return 'clicked';
  })()`);
  console.log('今日建议反馈 -> ' + todayClick);
  drain('今日反馈');

  // 5) 移动端底部导航
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true });
  await evalJs(`location.hash = '#/me'`);
  await sleep(2000);
  const mobile = await evalJs(`(() => { const n = document.getElementById('bottomnav'); return n ? { items: n.querySelectorAll('.nav-item').length, visible: getComputedStyle(n).display } : null; })()`);
  console.log('移动端底部导航 -> ' + JSON.stringify(mobile));
  if (!mobile || mobile.items !== 5 || mobile.visible === 'none') problems.push('移动端底部导航异常：' + JSON.stringify(mobile));
  drain('移动端');
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, '21-mobile-me.png'), Buffer.from(shot.result.data, 'base64'));

  console.log('\n--- 问题汇总 ---');
  console.log(problems.length ? problems.join('\n') : '无');
  ws.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('UI 测试异常：', e); process.exit(2); });
