'use strict';
// 账号、会话与数据隔离。密码只保存 scrypt 哈希；会话持久化，重启不掉线。
const crypto = require('crypto');
const store = require('./store');

const SESSION_DAYS = 7;

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, hash: h };
}
function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
}

function register(username, password, nickname) {
  const name = String(username || '').trim();
  if (name.length < 2) throw new Error('用户名至少 2 个字符');
  if (String(password || '').length < 6) throw new Error('密码至少 6 位');
  if (store.one('users', (u) => u.username === name)) throw new Error('该用户名已被使用');
  const { salt, hash } = hashPassword(password);
  return store.insert('users', { username: name, nickname: nickname || name, salt, hash });
}

function login(username, password) {
  const u = store.one('users', (x) => x.username === String(username || '').trim());
  if (!u || !verifyPassword(password, u.salt, u.hash)) throw new Error('用户名或密码不正确');
  return u;
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  store.insert('sessions', { token, userId, expiresAt });
  return { token, expiresAt };
}
function destroySession(token) { store.remove('sessions', (s) => s.token === token); }
function userByToken(token) {
  if (!token) return null;
  const s = store.one('sessions', (x) => x.token === token);
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) { store.remove('sessions', (x) => x.token === token); return null; }
  return store.one('users', (u) => u.id === s.userId) || null;
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function tokenFrom(req) { return parseCookies(req).sid || null; }
function currentUser(req) { return userByToken(tokenFrom(req)); }

module.exports = { register, login, createSession, destroySession, currentUser, tokenFrom, parseCookies, SESSION_DAYS };
