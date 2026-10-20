'use strict';
/* 打包前处理：去掉运行痕迹（会话、调用日志、临时文件），可选清空 API 密钥。
   用法：node scripts/prepare-package.js <目标目录> [strip-key] */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const stripKey = process.argv[3] === 'strip-key';
if (!dir || !fs.existsSync(dir)) {
  console.error('用法：node scripts/prepare-package.js <目标目录> [strip-key]');
  process.exit(1);
}

const removed = [];

// 1) 运行痕迹
for (const f of ['.run.pid', '当前地址.txt', '.public-ip.json']) {
  const p = path.join(dir, f);
  if (fs.existsSync(p)) { fs.unlinkSync(p); removed.push(f); }
}
const dataDir = path.join(dir, 'data');
if (fs.existsSync(dataDir)) {
  for (const f of fs.readdirSync(dataDir)) {
    if (/\.log$/i.test(f)) { fs.unlinkSync(path.join(dataDir, f)); removed.push('data/' + f); }
  }
  for (const d of ['edge-profile', 'shots']) {
    const p = path.join(dir, 'test', d);
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed.push('test/' + d); }
  }
}

// 2) 数据库：去掉会话与调用日志（换机后重新登录即可，数据本身保留）
const dbFile = path.join(dataDir, 'db.json');
let users = 0; let records = 0; let droppedUsers = 0; let droppedFiles = 0;
if (fs.existsSync(dbFile)) {
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  delete db.sessions;
  delete db.aiLogs;

  // 去掉自动化测试/调试产生的临时账号（如 u1a2b3c4、dbgxxx、richxxx），只保留真实账号
  const junkName = /^(u[a-z0-9]{6,}|u[a-z0-9]{6,}b|dbg[a-z0-9]+|rich[a-z0-9]+|newbie|tmp[a-z0-9]+|test[a-z0-9]*)$/i;
  const testIds = new Set((db.users || []).filter((u) => junkName.test(u.username || '')).map((u) => u.id));
  if (testIds.size) {
    const docIds = (db.documents || []).filter((d) => testIds.has(d.userId)).map((d) => d.id);
    for (const id of docIds) {
      for (const suffix of ['.txt', '.orig.pdf', '.orig.docx', '.orig.md', '.orig.txt']) {
        const f = path.join(dataDir, 'uploads', id + suffix);
        if (fs.existsSync(f)) { fs.unlinkSync(f); droppedFiles++; }
      }
    }
    db.users = (db.users || []).filter((u) => !testIds.has(u.id));
    droppedUsers = testIds.size;
    for (const k of Object.keys(db)) {
      if (!Array.isArray(db[k])) continue;
      db[k] = db[k].filter((o) => !(o && o.userId && testIds.has(o.userId)));
    }
  }

  users = (db.users || []).length;
  for (const k of Object.keys(db)) if (Array.isArray(db[k])) records += db[k].length;
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1), 'utf8');
}

// 3) 可选：清空密钥（收到包的人自己填，避免密钥外传）
//    密钥可能写在 config.local.json，也可能写在 .env（README 推荐方式），两处都要处理
const cfgFile = path.join(dir, 'config.local.json');
const envFile = path.join(dir, '.env');
let keyCleared = false;
if (stripKey && fs.existsSync(cfgFile)) {
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  if (cfg.ai) { cfg.ai.apiKey = ''; keyCleared = true; }
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}
if (stripKey && fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  let touched = false;
  const out = lines.map((line) => {
    const m = /^\s*AI_API_KEY\s*=\s*(.*)$/.exec(line);
    if (!m) return line;
    if (m[1].trim()) touched = true;
    return 'AI_API_KEY=';
  });
  fs.writeFileSync(envFile, out.join('\n'), 'utf8');
  if (touched) keyCleared = true;
}

// 4) 兜底自检：清空后不应再残留任何形如 sk-xxxx 的密钥
let leaked = 0;
if (stripKey) {
  const scan = (file) => {
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (/sk-[A-Za-z0-9]{16,}/.test(text)) leaked++;
    } catch (e) { /* 二进制文件跳过 */ }
  };
  for (const f of ['config.local.json', '.env', 'config.example.json']) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) scan(p);
  }
}

console.log('  已清理：' + (removed.length ? removed.join('、') : '无'));
if (droppedUsers) console.log('  已移除测试账号：' + droppedUsers + ' 个（含 ' + droppedFiles + ' 个上传文件）');
console.log('  数据：' + users + ' 个账号，' + records + ' 条业务记录（会话与调用日志已移除）');
console.log('  密钥：' + (keyCleared ? '已清空（config.local.json 与 .env），收到后填任意一处即可' : '已随包带走（注意不要外传）'));
if (leaked) console.log('  ⚠ 自检发现仍有疑似密钥：' + leaked + ' 个文件，请检查后再分发');
