'use strict';
// 路由聚合：把各功能模块注册的 'METHOD /path' 编译成匹配表，支持 :param
const modules = [
  require('./lib/api/auth'),
  require('./lib/api/profile'),
  require('./lib/api/selfreport'),
  require('./lib/api/solve'),
  require('./lib/api/resources'),
  require('./lib/api/docs'),
  require('./lib/api/tasks'),
  require('./lib/api/me')
];

const exact = new Map();
const patterns = [];

for (const mod of modules) {
  for (const [key, handler] of Object.entries(mod)) {
    const idx = key.indexOf(' ');
    const method = key.slice(0, idx);
    const path = key.slice(idx + 1);
    const segs = path.split('/').filter(Boolean);
    const rec = { method, path, segs, handler, dynamic: segs.some((s) => s.startsWith(':')) };
    if (!rec.dynamic) exact.set(method + ' ' + path, rec);
    else patterns.push(rec);
  }
}
patterns.sort((a, b) => (b.segs.filter((s) => !s.startsWith(':')).length - a.segs.filter((s) => !s.startsWith(':')).length));

function match(method, pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const hit = exact.get(method + ' ' + clean);
  if (hit) return { handler: hit.handler, params: {} };
  const parts = clean.split('/').filter(Boolean);
  for (const p of patterns) {
    if (p.method !== method || p.segs.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < p.segs.length; i++) {
      const s = p.segs[i];
      if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(parts[i]);
      else if (s !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handler: p.handler, params };
  }
  return null;
}

module.exports = { match, routes: Array.from(exact.keys()).concat(patterns.map((p) => p.method + ' ' + p.path)) };
