'use strict';
// F-01 基本信息 / 学习目标与时间约束，F-02 预设库与院校专业背景资料
const store = require('../store');
const seed = require('../seed');
const util = require('./util');
const workers = require('../../workers');

const EFFECT_PROMISE = /(\d+\s*(天|日|周|个?月|小时))[^。；，,\n]{0,6}(精通|掌握|学会|搞定|速成|突破|提分)/;

function schoolList() {
  return seed.SCHOOLS.map((s, i) => ({ id: 'sch' + i, name: s[0], province: s[1], level: s[2], type: s[3] }));
}
const SCHOOLS = schoolList();
const MAJORS = seed.MAJORS.map((m, i) => ({ id: 'maj' + i, discipline: m[0], category: m[1], name: m[2], code: m[3] }));

async function getProfile(ctx) {
  const user = util.auth(ctx);
  return { profile: util.profileOf(user.id), terms: util.TERMS, programYearsOptions: [2, 3, 4, 5] };
}

async function putProfile(ctx) {
  const user = util.auth(ctx);
  const b = ctx.body || {};
  if (b.skip) {
    const old = store.one('profiles', (p) => p.userId === user.id);
    if (old) store.update('profiles', (p) => p.userId === user.id, { skipped: true });
    else store.insert('profiles', { userId: user.id, skipped: true });
    return { ok: true, profile: util.profileOf(user.id) };
  }
  util.need(b.school, '请填写院校');
  util.need(b.majorName, '请选择或填写专业');
  util.need(util.TERMS.includes(b.term), '请选择当前学期');
  const year = Number(b.enrollmentYear);
  util.need(year >= 2000 && year <= new Date().getFullYear(), '入学年份不正确');
  const py = Number(b.programYears) || 4;
  util.need([2, 3, 4, 5].includes(py), '学制年限不正确');
  if (b.gender) util.need(['男', '女', '不愿透露'].includes(b.gender), '性别取值不正确');
  if (String(b.school).trim().length < 2) util.need(false, '院校名称至少 2 个字符');

  const before = store.one('profiles', (p) => p.userId === user.id) || {};
  const patch = {
    school: String(b.school).trim().slice(0, 50),
    schoolSource: b.schoolSource === '库内匹配' ? '库内匹配' : '用户自填',
    majorName: String(b.majorName).trim().slice(0, 60),
    majorCode: String(b.majorCode || '').slice(0, 12),
    discipline: String(b.discipline || '').slice(0, 20),
    majorCategory: String(b.majorCategory || '').slice(0, 20),
    enrollmentYear: year, programYears: py,
    term: b.term, department: String(b.department || '').slice(0, 40),
    gender: b.gender || '', skipped: false
  };
  const fields = ['school', 'majorName', 'term', 'enrollmentYear', 'programYears', 'department', 'gender'];
  for (const f of fields) {
    if (String(before[f] || '') !== String(patch[f] || '')) {
      store.insert('profileChangeLogs', { userId: user.id, field: f, oldValue: String(before[f] || ''), newValue: String(patch[f] || '') });
    }
  }
  if (before.id) store.update('profiles', (p) => p.userId === user.id, patch);
  else store.insert('profiles', Object.assign({ userId: user.id }, patch));
  return { ok: true, profile: util.profileOf(user.id) };
}

async function searchSchools(ctx) {
  util.auth(ctx);
  const q = String(ctx.query.q || '').trim();
  let list = SCHOOLS;
  if (q) {
    const lower = q.toLowerCase();
    list = SCHOOLS.filter((s) => s.name.includes(q) || s.name.replace(/(大学|学院|职业技术大学|职业技术)/g, '').includes(q) || s.province.includes(q) || s.name.toLowerCase().includes(lower));
  }
  return { list: list.slice(0, 30), total: list.length };
}
async function searchMajors(ctx) {
  util.auth(ctx);
  const q = String(ctx.query.q || '').trim();
  const disc = String(ctx.query.discipline || '').trim();
  let list = MAJORS;
  if (disc) list = list.filter((m) => m.discipline === disc);
  if (ctx.query.category) list = list.filter((m) => m.category === ctx.query.category);
  if (q) list = list.filter((m) => m.name.includes(q) || m.category.includes(q) || m.discipline.includes(q) || m.code.startsWith(q));
  return { list: list.slice(0, 40), total: list.length };
}
async function majorTree(ctx) {
  util.auth(ctx);
  const tree = {};
  for (const m of MAJORS) {
    tree[m.discipline] = tree[m.discipline] || {};
    tree[m.discipline][m.category] = tree[m.discipline][m.category] || [];
    tree[m.discipline][m.category].push({ id: m.id, name: m.name, code: m.code });
  }
  return { tree, disciplines: Object.keys(tree) };
}

/* ------------------------------- 学习目标 ------------------------------- */
async function listGoals(ctx) {
  const user = util.auth(ctx);
  return { list: store.find('goals', (g) => g.userId === user.id) };
}
async function addGoal(ctx) {
  const user = util.auth(ctx);
  const title = String(ctx.body.title || '').trim();
  util.need(title, '请填写目标名称');
  util.need(!EFFECT_PROMISE.test(title), '目标里不要写死时间与效果（例如「30 天精通」），换成想学的内容就好');
  const goal = store.insert('goals', {
    userId: user.id, title: title.slice(0, 60), type: String(ctx.body.type || '其他').slice(0, 20),
    targetDate: String(ctx.body.targetDate || '').slice(0, 10), priority: ['高', '中', '低'].includes(ctx.body.priority) ? ctx.body.priority : '中',
    status: '进行中'
  });
  return { goal };
}
async function patchGoal(ctx) {
  const user = util.auth(ctx);
  const g = store.one('goals', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(g, '目标不存在', 404);
  const patch = {};
  for (const k of ['title', 'type', 'targetDate', 'priority', 'status']) if (ctx.body[k] !== undefined) patch[k] = String(ctx.body[k]).slice(0, 60);
  if (patch.title) util.need(!EFFECT_PROMISE.test(patch.title), '目标里不要写死时间与效果');
  store.update('goals', (x) => x.id === g.id, patch);
  return { goal: store.one('goals', (x) => x.id === g.id) };
}
async function deleteGoal(ctx) {
  const user = util.auth(ctx);
  store.remove('goals', (g) => g.id === ctx.params.id && g.userId === user.id);
  return { ok: true };
}

/* ------------------------------ 时间约束 ------------------------------ */
async function getTime(ctx) {
  const user = util.auth(ctx);
  return { time: store.one('timeConstraints', (t) => t.userId === user.id) || null };
}
async function putTime(ctx) {
  const user = util.auth(ctx);
  const b = ctx.body || {};
  const days = Number(b.daysPerWeek);
  const minutes = Number(b.minutesPerDay);
  util.need(days >= 1 && days <= 7, '每周可学天数请填 1 到 7');
  util.need(minutes >= 15 && minutes <= 1440, '每天可投入时长请填 15 到 1440 分钟');
  const restDays = (Array.isArray(b.restDays) ? b.restDays : []).map(Number).filter((n) => n >= 1 && n <= 7);
  util.need(restDays.length <= 6 || !!b.confirmAllRest, '一周七天都设为休息日的话，就没法安排计划了。确认的话请再点一次。');
  const patch = {
    daysPerWeek: days, minutesPerDay: minutes, restDays,
    preferredSlots: String(b.preferredSlots || '').slice(0, 60), importantDates: String(b.importantDates || '').slice(0, 120)
  };
  const old = store.one('timeConstraints', (t) => t.userId === user.id);
  let changed = false;
  if (old) {
    changed = old.minutesPerDay !== minutes || JSON.stringify(old.restDays) !== JSON.stringify(restDays) || old.daysPerWeek !== days;
    store.update('timeConstraints', (t) => t.userId === user.id, patch);
  } else {
    store.insert('timeConstraints', Object.assign({ userId: user.id }, patch));
  }
  const plans = store.find('studyPlans', (p) => p.userId === user.id && p.status === '进行中');
  return { time: store.one('timeConstraints', (t) => t.userId === user.id), timeChanged: changed, activePlans: plans.map((p) => ({ id: p.id, title: p.title })) };
}

/* --------------------------- F-02 院校 / 专业资料 --------------------------- */
async function listEntityProfiles(ctx) {
  const user = util.auth(ctx);
  return { list: store.find('schoolMajorProfiles', (p) => p.userId === user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
}
async function createEntityProfile(ctx) {
  const user = util.auth(ctx);
  const kind = ctx.body.kind === 'school' ? 'school' : 'major';
  const raw = String(ctx.body.raw || '').trim();
  util.need(raw.length >= 2, '内容太短了，请写完整名称');
  util.need(!/^[\p{P}\p{S}\d\s]+$/u.test(raw), '请填写有效的名称');
  let rec = store.one('schoolMajorProfiles', (p) => p.userId === user.id && p.kind === kind && p.raw === raw);
  if (!rec) {
    rec = store.insert('schoolMajorProfiles', { userId: user.id, kind, raw: raw.slice(0, 60), status: 'pending', items: [], attributes: {}, version: 1 });
    util.async(() => workers.verifyEntity(rec.id));
  }
  return { item: rec };
}
async function feedbackEntityProfile(ctx) {
  const user = util.auth(ctx);
  const rec = store.one('schoolMajorProfiles', (p) => p.id === ctx.params.id && p.userId === user.id);
  util.need(rec, '记录不存在', 404);
  const text = String(ctx.body.text || '').trim();
  util.need(text, '请说明哪里不对');
  store.insert('schoolMajorFeedbacks', { userId: user.id, profileId: rec.id, text: text.slice(0, 300) });
  store.update('schoolMajorProfiles', (p) => p.id === rec.id, { status: 'pending', note: '已收到你的反馈，正在重新核对。' });
  util.async(() => workers.verifyEntity(rec.id));
  return { ok: true };
}
async function reverifyEntityProfile(ctx) {
  const user = util.auth(ctx);
  const rec = store.one('schoolMajorProfiles', (p) => p.id === ctx.params.id && p.userId === user.id);
  util.need(rec, '记录不存在', 404);
  store.update('schoolMajorProfiles', (p) => p.id === rec.id, { status: 'pending' });
  util.async(() => workers.verifyEntity(rec.id));
  return { ok: true };
}

module.exports = {
  'GET /api/profile': getProfile,
  'PUT /api/profile': putProfile,
  'GET /api/presets/schools': searchSchools,
  'GET /api/presets/majors': searchMajors,
  'GET /api/presets/majors/tree': majorTree,
  'GET /api/goals': listGoals,
  'POST /api/goals': addGoal,
  'PATCH /api/goals/:id': patchGoal,
  'DELETE /api/goals/:id': deleteGoal,
  'GET /api/time-constraint': getTime,
  'PUT /api/time-constraint': putTime,
  'GET /api/school-major-profile': listEntityProfiles,
  'POST /api/school-major-profile': createEntityProfile,
  'POST /api/school-major-profile/:id/feedback': feedbackEntityProfile,
  'POST /api/school-major-profile/:id/reverify': reverifyEntityProfile
};
