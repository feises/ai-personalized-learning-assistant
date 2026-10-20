'use strict';
/* 核心：接口调用、DOM 小工具、路由、布局、组件 */
const App = (() => {
  const PAGES = {};
  const state = { user: null, me: null, path: '', args: [], pageDrawn: false };
  let routeToken = 0;

  /* ----------------------------- 接口 ----------------------------- */
  async function api(method, path, body, opts = {}) {
    const init = { method, credentials: 'same-origin', headers: {} };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, init); } catch (e) { throw new Error('网络连接失败，请检查服务是否在运行'); }
    if (res.status === 401 && !opts.silent) { state.user = null; location.hash = '#/login'; throw new Error('请先登录'); }
    const ctype = res.headers.get('content-type') || '';
    if (ctype.includes('application/json')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    if (!res.ok) throw new Error('请求失败（' + res.status + '）');
    return res;
  }
  const get = (p, o) => api('GET', p, undefined, o);
  const post = (p, b, o) => api('POST', p, b, o);
  const put = (p, b) => api('PUT', p, b);
  const patch = (p, b) => api('PATCH', p, b);
  const del = (p) => api('DELETE', p);

  /* ----------------------------- 工具 ----------------------------- */
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function toast(msg, type) {
    const box = $('#toast');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-6px)'; }, 2300);
    setTimeout(() => el.remove(), 2700);
  }
  function loading(on, text) {
    const el = $('#loading');
    if (text) $('#loading-text').textContent = text;
    el.classList.toggle('hidden', !on);
  }
  function modal(opt) {
    const wrap = $('#modal');
    wrap.innerHTML = '<div class="modal"><h3>' + esc(opt.title || '') + '</h3><div class="mb16">' + (opt.body || '') + '</div><div class="row" style="justify-content:flex-end">' +
      (opt.actions || []).map((a, i) => '<button class="btn ' + (a.kind || '') + '" data-act="' + i + '">' + esc(a.label) + '</button>').join('') + '</div></div>';
    wrap.classList.remove('hidden');
    $$('[data-act]', wrap).forEach((b) => b.onclick = () => {
      const a = opt.actions[Number(b.dataset.act)];
      const keep = a.onClick && a.onClick(wrap) === false;
      if (!keep) closeModal();
    });
    wrap.onclick = (e) => { if (e.target === wrap) closeModal(); };
  }
  function closeModal() { const w = $('#modal'); w.classList.add('hidden'); w.innerHTML = ''; }
  function confirmDialog(title, text, onYes, yesLabel) {
    modal({ title, body: '<p class="muted">' + esc(text) + '</p>', actions: [{ label: '取消' }, { label: yesLabel || '确定', kind: 'primary', onClick: onYes }] });
  }
  const fmtDate = (s) => (s ? String(s).slice(5, 10).replace('-', '/') : '');
  const fmtDateTime = (s) => (s ? new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const todayStr = () => new Date().toLocaleDateString('sv-SE');
  const WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const TERMS = ['大一上', '大一下', '大二上', '大二下', '大三上', '大三下', '大四上', '大四下', '大五上', '大五下'];

  /* ----------------------------- 图标 ----------------------------- */
  const I = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18M8 15h3"/></svg>',    solve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3l2.2 5.3L20 10l-4.4 3.4L16.4 20 12 16.8 7.6 20l.8-6.6L4 10l5.8-1.7z"/></svg>',
    resources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 5.5A2.5 2.5 0 016.5 3H19v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M19 18v3H6.5A2.5 2.5 0 014 18.5"/></svg>',
    me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c1.3-3.6 4.1-5.4 7.5-5.4s6.2 1.8 7.5 5.4"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 4h11a2 2 0 012 2v14H7a2 2 0 01-2-2z"/><path d="M8 8h7M8 12h5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l16 16"/><path d="M9.9 5.9A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3.4 4.1M6.2 7.5A16.7 16.7 0 002.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.8-.5"/><path d="M9.9 10.1a3 3 0 104.2 4.2"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 19V9M12 19V5M19 19v-6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 13a4 4 0 005.7 0l3-3A4 4 0 0013 4.3l-1 1"/><path d="M14 11a4 4 0 00-5.7 0l-3 3A4 4 0 0011 19.7l1-1"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9.5 12.2l1.8 1.8 3.4-3.6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" width="16" height="16"><path d="M15 5l-7 7 7 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M12 5v14M5 12h14"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="16" height="16"><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/></svg>'
  };
  const zoneIcon = { B: I.me, C: I.book, D: I.shield };

  /* ----------------------------- 路由 ----------------------------- */
  function register(name, fn) { PAGES[name] = fn; }
  function resolve(path) {
    const segs = String(path || '').split('/').filter(Boolean);
    for (let i = segs.length; i > 0; i--) {
      const key = segs.slice(0, i).join('/');
      if (PAGES[key]) return { name: key, args: segs.slice(i) };
    }
    return { name: 'today', args: [] };
  }
  function navItems() {
    return [
      { path: 'today', label: '今日', icon: I.today },
      { path: 'solve', label: 'AI 搜题', icon: I.solve },
      { path: 'resources', label: '资源搜索推送', short: '资源', icon: I.resources },
      { path: 'me', label: '我的', icon: I.me }
    ];
  }
  function renderChrome() {
    const items = navItems();
    const cur = state.path.split('/')[0];
    const nav = (cls) => items.map((it) => '<a class="nav-item' + (cur === it.path ? ' active' : '') + '" href="#/' + it.path + '">' + it.icon + '<span>' + (cls === 'short' ? (it.short || it.label) : it.label) + '</span></a>').join('');
    $('#sidebar').innerHTML = state.user
      ? '<div class="brand"><div class="logo">学</div><div><b>AI 学习助手</b><span>个性化学习安排</span></div></div>' + nav() +
        '<div class="foot">' + esc(state.user.nickname) + '<br><a href="javascript:App.logout()">退出登录</a></div>'
      : '';
    $('#bottomnav').innerHTML = state.user ? nav('short') : '';
  }
  function render(html) {
    state.pageDrawn = true;
    let m = document.getElementById('main');
    if (!m) {
      m = document.createElement('main');
      m.id = 'main'; m.className = 'main';
      (document.getElementById('app') || document.body).appendChild(m);
    }
    m.innerHTML = html;
  }
  function head(title, sub, actions) {
    return '<div class="page-head row between"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' + (actions || '') + '</div>';
  }
  function backBar(text) { return '<a class="btn ghost sm mb12" href="javascript:history.back()">' + I.back + esc(text || '返回') + '</a>'; }

  async function route() {
    const path = location.hash.replace(/^#\/?/, '');
    if (!state.user && path !== 'login' && path !== 'onboarding') { location.hash = '#/login'; return; }
    if (state.user && (path === '' || path === 'login')) { location.hash = '#/today'; return; }
    const auth = document.getElementById('authwrap');
    if (auth) auth.remove();
    const app = document.getElementById('app');
    if (app) app.style.display = '';
    const r = resolve(path);
    state.path = path; state.args = r.args;
    renderChrome();
    // 页面可能要等接口（例如当天建议需要模型生成），超过 150ms 就先给出加载反馈
    state.pageDrawn = false;
    const myToken = ++routeToken;
    const timer = setTimeout(() => {
      if (routeToken === myToken && !state.pageDrawn) render('<div class="card"><div class="inline-loading"><div class="spinner"></div>加载中…</div></div>');
    }, 150);
    try { await PAGES[r.name](r.args); } catch (e) { render('<div class="card"><h3>出了点问题</h3><p class="muted mt8">' + esc(e.message) + '</p></div>'); }
    clearTimeout(timer);
    window.scrollTo({ top: 0 });
  }
  async function go(path) { location.hash = '#/' + path; }

  /* ----------------------------- 启动 ----------------------------- */
  async function boot() {
    try { state.me = await get('/api/auth/me', { silent: true }); state.user = state.me.user; } catch (e) { state.user = null; }
    window.addEventListener('hashchange', route);
    await route();
  }
  async function refreshMe() { try { state.me = await get('/api/auth/me', { silent: true }); state.user = state.me.user; } catch (e) {} }
  async function logout() { await post('/api/auth/logout', {}); state.user = null; location.hash = '#/login'; }
  async function needProfile() {
    await refreshMe();
    if (state.me && !state.me.flags.hasProfile && !state.me.flags.profileSkipped) { location.hash = '#/onboarding'; return false; }
    return true;
  }

  /* ----------------------------- 组件 ----------------------------- */
  function chart(id, data, opt = {}) {
    const items = (data || []).filter((d) => d && d.count > 0).slice(0, 8);
    if (!items.length) return '<div class="empty"><b>还没有可统计的数据</b>搜几道题之后，这里就会出现分布情况</div>';
    const max = Math.max.apply(null, items.map((d) => d.count));
    const bw = 100 / items.length;
    const bars = items.map((d, i) => {
      const hh = max ? Math.max(6, (d.count / max) * 132) : 6;
      const x = i * bw + bw * 0.18, w = bw * 0.64;
      return '<g class="bar" data-name="' + esc(d.name) + '" data-count="' + d.count + '">' +
        '<rect x="' + x + '%" y="' + (148 - hh) + '" width="' + w + '%" height="' + hh + '" rx="6" fill="' + (opt.color || '#6366f1') + '" opacity=".9"></rect>' +
        '<text class="axis" x="' + (i * bw + bw / 2) + '%" y="164" text-anchor="middle">' + esc(String(d.name).slice(0, 6)) + '</text>' +
        '<text class="axis" x="' + (i * bw + bw / 2) + '%" y="' + (142 - hh) + '" text-anchor="middle" fill="#3b4353">' + d.count + '</text></g>';
    }).join('');
    return '<div class="chart"><svg viewBox="0 0 100 176" preserveAspectRatio="none" height="176" style="min-width:' + Math.max(320, items.length * 56) + 'px">' + bars + '</svg></div>' +
      (opt.hint ? '<div class="chart-hint">' + esc(opt.hint) + '</div>' : '');
  }
  function bindChart(root, onSelect) {
    $$('.bar', root).forEach((g) => {
      g.addEventListener('mousemove', (e) => {
        let tip = $('.tooltip'); if (!tip) { tip = document.createElement('div'); tip.className = 'tooltip'; document.body.appendChild(tip); }
        tip.textContent = g.dataset.name + '：' + g.dataset.count + ' 次';
        tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 30) + 'px'; tip.style.opacity = '1';
      });
      g.addEventListener('mouseleave', () => { const tip = $('.tooltip'); if (tip) tip.style.opacity = '0'; });
      if (onSelect) g.addEventListener('click', () => onSelect(g.dataset.name));
    });
  }
  function chip(text, kind) { return '<span class="chip' + (kind ? ' ' + kind : '') + '">' + esc(text) + '</span>'; }
  function empty(title, text, actionHtml) {
    return '<div class="empty"><b>' + esc(title) + '</b>' + esc(text || '') + (actionHtml ? '<div class="mt12">' + actionHtml + '</div>' : '') + '</div>';
  }
  function statusChip(state) {
    const map = { '已核实': 'ok', '可用': 'ok', '已完成': 'ok', '有近期正确表现': 'ok', '进行中': 'brand', '待核实': 'warn', '需复习': 'warn', '需调整': 'warn', '已失效': 'warn', '核对失败': 'warn' };
    return chip(state, map[state] || '');
  }

  return {
    state, api, get, post, put, patch, del, esc, $, $$, toast, loading, modal, closeModal, confirmDialog,
    fmtDate, fmtDateTime, todayStr, WEEK, TERMS, register, route, go, boot, logout, refreshMe, needProfile,
    render, renderChrome, head, backBar, chart, bindChart, chip, empty, statusChip, I, zoneIcon
  };
})();
