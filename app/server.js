'use strict';
// HTTP 服务：静态资源 + JSON API 路由 + 会话。零依赖。
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 读取 .env（可选）：KEY=VALUE，支持 # 注释与引号；不覆盖已存在的环境变量。
// 密钥只走环境变量，仓库里不出现任何真实密钥。
function loadDotEnv() {
  const candidates = [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.charAt(0) === '#') continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (value.length > 1) {
          const q = value.charAt(0);
          if ((q === '"' || q === "'") && value.charAt(value.length - 1) === q) value = value.slice(1, -1);
        }
        if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
      }
    } catch (e) { /* .env 读取失败不影响启动 */ }
  }
}
loadDotEnv();

const auth = require('./lib/auth');
const ai = require('./lib/ai');
const store = require('./lib/store');
const routes = require('./routes');
const { startWorkers } = require('./workers');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const max = limit || 8 * 1024 * 1024;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('内容过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 极简 multipart/form-data 解析（用于资料上传）
function parseMultipart(buf, boundary) {
  const parts = [];
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  while (pos >= 0) {
    const next = buf.indexOf(delim, pos + delim.length);
    if (next < 0) break;
    const seg = buf.slice(pos + delim.length + 2, next - 2);
    const headEnd = seg.indexOf('\r\n\r\n');
    if (headEnd > 0) {
      const head = seg.slice(0, headEnd).toString('utf8');
      const data = seg.slice(headEnd + 4);
      const nameM = /name="([^"]*)"/.exec(head);
      const fileM = /filename="([^"]*)"/.exec(head);
      const typeM = /Content-Type:\s*([^\r\n]+)/i.exec(head);
      parts.push({
        name: nameM ? nameM[1] : '', filename: fileM ? fileM[1] : null,
        contentType: typeM ? typeM[1].trim() : 'application/octet-stream', data
      });
    }
    pos = next;
  }
  return parts;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

// 服务自己写日志，便于一键启动后查看（不依赖控制台重定向）
const LOG_FILE = path.join(__dirname, 'data', 'server.log');
function logLine(msg) {
  const line = '[' + new Date().toLocaleString('zh-CN') + '] ' + msg;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) { /* 日志失败不影响服务 */ }
}
process.on('uncaughtException', (e) => logLine('未捕获异常：' + ((e && e.stack) || e)));
process.on('unhandledRejection', (e) => logLine('未处理的 Promise 异常：' + ((e && e.stack) || e)));

function serveStatic(req, res, pathname) {
  const noStore = { 'Cache-Control': 'no-store, must-revalidate' };
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403, noStore); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404, noStore); res.end('not found'); return; }
        res.writeHead(200, Object.assign({ 'Content-Type': MIME['.html'] }, noStore)); res.end(html);
      });
      return;
    }
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }, noStore));
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) { serveStatic(req, res, pathname); return; }

  const route = routes.match(req.method, pathname);
  if (!route) { sendJson(res, 404, { error: '接口不存在' }); return; }

  const ctx = {
    req, res, params: route.params,
    query: Object.fromEntries(url.searchParams.entries()),
    user: auth.currentUser(req),
    body: {},
    raw: null,
    parts: null
  };
  try {
    const ctype = String(req.headers['content-type'] || '');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (ctype.includes('multipart/form-data')) {
        const boundary = /boundary=([^;]+)/.exec(ctype);
        ctx.raw = await readBody(req, 220 * 1024 * 1024);
        ctx.parts = boundary ? parseMultipart(ctx.raw, boundary[1].trim()) : [];
      } else {
        const buf = await readBody(req, 24 * 1024 * 1024);
        if (buf.length) { try { ctx.body = JSON.parse(buf.toString('utf8')); } catch (e) { ctx.body = {}; } }
      }
    }
    const out = await route.handler(ctx);
    if (out && out.__file) {
      res.writeHead(200, {
        'Content-Type': out.type || 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + encodeURIComponent(out.filename) + '"'
      });
      res.end(out.data);
      return;
    }
    if (out && out.__text) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(out.data); return; }
    sendJson(res, out && out.__status ? out.__status : 200, out === undefined ? { ok: true } : out);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    if (status >= 500) logLine('[api 500] ' + req.method + ' ' + pathname + ' :: ' + ((e && e.stack) || e));
    sendJson(res, status, { error: (e && e.message) || '服务器内部错误' });
  }
});

// 列出可用的局域网地址（过滤回环与虚拟网卡），用于启动时打印访问地址，适应 IP 变化
function lanAddresses() {
  const skip = /loopback|virtual|vmware|virtualbox|hyper-v|vethernet|wsl|bluetooth|tap|npcap|zerotier|tailscale|docker/i;
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    if (skip.test(name)) continue;
    for (const a of ifs[name] || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.') || a.address === '0.0.0.0') continue;
      out.push({ name, address: a.address });
    }
  }
  const score = (ip) => (ip.startsWith('192.168.') ? 3 : ip.startsWith('10.') ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 0);
  return out.sort((a, b) => score(b.address) - score(a.address));
}

const cfg = ai.serverConfig();
server.listen(cfg.port, cfg.host, () => {
  const ai0 = ai.readConfig();
  const all = cfg.host === '0.0.0.0' || cfg.host === '::';
  logLine('服务已启动（pid ' + process.pid + '，node ' + process.execPath + '，监听 ' + cfg.host + ':' + cfg.port + '）');
  if (all) {
    logLine('  本机访问：http://127.0.0.1:' + cfg.port);
    const lans = lanAddresses();
    if (lans.length) {
      logLine('  局域网访问（手机 / 其他电脑，需与本机在同一网络）：');
      for (const l of lans.slice(0, 3)) logLine('    http://' + l.address + ':' + cfg.port + '   [' + l.name + ']');
    } else {
      logLine('  未检测到局域网地址（当前可能只有回环网卡）');
    }
  } else {
    logLine('  访问地址：http://' + cfg.host + ':' + cfg.port);
  }
  logLine('模型：' + ai0.provider + ' / ' + ai0.model + '（视觉：' + ai0.visionModel + '，可在 config.local.json 或环境变量中切换）');
  if (!ai0.apiKey) {
    logLine('未检测到 AI 密钥：请在 app/.env 或环境变量 AI_API_KEY 中配置后重启（其余功能仍可浏览）。');
  }
  startWorkers();
});
server.on('error', (e) => {
  logLine('启动失败：' + (e && e.message));
  process.exit(1);
});

process.on('SIGINT', () => { store.saveNow(); process.exit(0); });
process.on('SIGTERM', () => { store.saveNow(); process.exit(0); });
