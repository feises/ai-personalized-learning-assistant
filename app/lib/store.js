'use strict';
// 极简持久化：整个库是一个 JSON 文件，按集合（数组）组织。演示项目足够，且便于查看与导出。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = {};
let timer = null;

function load() {
  if (!fs.existsSync(DB_FILE)) { db = {}; return; }
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) || {}; } catch (e) { console.error('读取数据库失败，已重置：', e.message); db = {}; }
}
load();

function saveNow() {
  if (timer) { clearTimeout(timer); timer = null; }
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}
function save() { if (timer) return; timer = setTimeout(() => { timer = null; saveNow(); }, 200); }

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();

function col(name) { if (!Array.isArray(db[name])) db[name] = []; return db[name]; }
function insert(name, obj) {
  const rec = Object.assign({ id: uid(), createdAt: now() }, obj);
  col(name).push(rec); save(); return rec;
}
function all(name) { return col(name); }
function find(name, fn) { return col(name).filter(fn); }
function one(name, fn) { return col(name).find(fn); }
function update(name, fn, patch) {
  let n = 0;
  for (const o of col(name)) if (fn(o)) { Object.assign(o, typeof patch === 'function' ? patch(o) : patch); o.updatedAt = now(); n++; }
  if (n) save(); return n;
}
function remove(name, fn) {
  const before = col(name).length;
  db[name] = col(name).filter((o) => !fn(o));
  const n = before - db[name].length;
  if (n) save(); return n;
}
function drop(name) { delete db[name]; save(); }

module.exports = { db: () => db, save, saveNow, col, insert, all, find, one, update, remove, drop, uid, now, DATA_DIR, UPLOAD_DIR, DB_FILE };
