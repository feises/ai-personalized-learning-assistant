'use strict';
// 路由公共工具：错误约定、画像摘要、主题归一、资源链接构造、日期计算。
const store = require('../store');
const seed = require('../seed');
const prompts = require('../prompts');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status || 400; }
}
function need(cond, message, status) { if (!cond) throw new HttpError(status || 400, message); }
function auth(ctx) { need(ctx.user, '请先登录', 401); return ctx.user; }

const TERMS = ['大一上', '大一下', '大二上', '大二下', '大三上', '大三下', '大四上', '大四下', '大五上', '大五下'];

function gradeOf(term) { return term ? String(term).slice(0, 2) : ''; }
function educationOf(programYears) { return Number(programYears) <= 3 ? '专科' : '本科'; }

function profileOf(userId) {
  const p = store.one('profiles', (x) => x.userId === userId) || {};
  const goals = store.find('goals', (g) => g.userId === userId && g.status !== 'archived');
  const time = store.one('timeConstraints', (t) => t.userId === userId) || null;
  const grade = gradeOf(p.term) || (p.enrollmentYear ? '大' + Math.min(5, Math.max(1, new Date().getFullYear() - Number(p.enrollmentYear) + 1)) + '' : '');
  return {
    school: p.school || '', schoolSource: p.schoolSource || '', majorName: p.majorName || '', majorCode: p.majorCode || '',
    discipline: p.discipline || '', majorCategory: p.majorCategory || '', enrollmentYear: p.enrollmentYear || '',
    programYears: p.programYears || 4, term: p.term || '', grade, educationLevel: educationOf(p.programYears || 4),
    department: p.department || '', gender: p.gender || '', skipped: !!p.skipped, goals, time, complete: !!(p.school && p.majorName && p.term)
  };
}
function aiContext(userId) {
  const p = profileOf(userId);
  return { majorName: p.majorName, grade: p.grade, school: p.school, educationLevel: p.educationLevel };
}

/* --------------------------- 主题（知识点）归一 --------------------------- */
function normalizeName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n) return '';
  if (seed.TOPIC_ALIASES[n]) return seed.TOPIC_ALIASES[n];
  const lower = n.toLowerCase();
  for (const [k, v] of Object.entries(seed.TOPIC_ALIASES)) if (k.toLowerCase() === lower) return v;
  return n;
}
function getOrCreateTopic(userId, rawName) {
  const name = normalizeName(rawName) || '未归类';
  let t = store.one('topics', (x) => x.userId === userId && x.name === name);
  if (!t) t = store.insert('topics', { userId, name, aliases: [], source: 'auto' });
  return t;
}
function topicNames(userId, count) {
  const states = store.find('knowledgeStates', (s) => s.userId === userId);
  const stateMap = new Map(states.map((s) => [s.topicId, s]));
  const recs = store.find('learningRecords', (r) => r.userId === userId);
  const freq = new Map();
  for (const r of recs) for (const tid of r.topicIds || []) freq.set(tid, (freq.get(tid) || 0) + 1);
  const qs = store.find('questionRecords', (q) => q.userId === userId);
  for (const q of qs) for (const tid of q.topicIds || []) freq.set(tid, (freq.get(tid) || 0) + 2);
  return store.find('topics', (t) => t.userId === userId)
    .map((t) => ({ name: t.name, score: freq.get(t.id) || 0, state: stateMap.get(t.id) ? stateMap.get(t.id).state : '' }))
    .sort((a, b) => b.score - a.score).slice(0, count || 8);
}

/* ------------------------------ 资源链接构造 ------------------------------ */
const URL_TEMPLATES = {
  icourse163: (q) => 'https://www.icourse163.org/search.htm?search=' + encodeURIComponent(q),
  xuetangx: (q) => 'https://www.xuetangx.com/search?query=' + encodeURIComponent(q),
  bilibili: (q) => 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(q),
  zhihu: (q) => 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(q),
  github: (q) => 'https://github.com/search?q=' + encodeURIComponent(q),
  arxiv: (q) => 'https://arxiv.org/search/?query=' + encodeURIComponent(q) + '&searchtype=all',
  douban: (q) => 'https://search.douban.com/book/subject_search?search_text=' + encodeURIComponent(q),
  khan: (q) => 'https://zh.khanacademy.org/search?page_search_query=' + encodeURIComponent(q)
};
const PLATFORM_MAP = new Map(prompts.PLATFORMS.map((p) => [p.key, p]));
function normalizeCard(card) {
  const key = PLATFORM_MAP.has(String(card.platform)) ? String(card.platform) : 'bilibili';
  const platform = PLATFORM_MAP.get(key);
  const title = String(card.title || '').slice(0, 80) || '学习资源';
  const topic = String(card.topic || title).slice(0, 60);
  const type = String(card.type || platform.type);
  const access = ['免费', '需注册', '需付费'].includes(card.access) ? card.access : '免费';
  const keyword = (topic && topic.length >= 2 ? topic : title).replace(/[《》「」]/g, '');
  return {
    title, platform: key, platformName: platform.name, type, topic, audience: String(card.audience || '本专业学生').slice(0, 40),
    access, intro: String(card.intro || '').slice(0, 200), reason: String(card.reason || '').slice(0, 120),
    url: URL_TEMPLATES[key](keyword), keyword, linkStatus: '待核验', lastVerifiedAt: null
  };
}

/* --------------------------------- 日期 --------------------------------- */
function dateStr(d) { return new Date(d).toISOString().slice(0, 10); }
function today() { return dateStr(new Date()); }
function addDays(dateString, n) { const d = new Date(dateString + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return dateStr(d); }
function weekdayIndex(dateString) { const d = new Date(dateString + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; } // 1=周一
function isRestDay(dateString, restDays) {
  const arr = Array.isArray(restDays) ? restDays.map(Number) : [];
  if (!arr.length) return false;
  if (arr.length >= 7) return true;
  return arr.includes(weekdayIndex(dateString));
}
function nextWorkday(dateString, restDays) {
  let d = dateString;
  for (let i = 0; i < 21; i++) { if (!isRestDay(d, restDays)) return d; d = addDays(d, 1); }
  return dateString;
}

function async(task, onError) { setImmediate(() => Promise.resolve().then(task).catch((e) => { console.error('[bg]', e && e.message || e); if (onError) onError(e); })); }

module.exports = {
  HttpError, need, auth, profileOf, aiContext, TERMS, gradeOf, educationOf,
  normalizeName, getOrCreateTopic, topicNames, normalizeCard, PLATFORM_MAP, URL_TEMPLATES,
  dateStr, today, addDays, weekdayIndex, isRestDay, nextWorkday, async
};
