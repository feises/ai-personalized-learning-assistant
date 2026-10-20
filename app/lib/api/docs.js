'use strict';
// F-09 资料上传解析、难点提示、学习计划；含 N-01 的计划落地数据（任务在 tasks.js 中执行）
const fs = require('fs');
const path = require('path');
const store = require('../store');
const parse = require('../parse');
const ai = require('../ai');
const prompts = require('../prompts');
const util = require('./util');
const workers = require('../../workers');
const scheduler = require('../scheduler');

// 原文件与提取出的文本分开存放，避免 .txt/.md 上传时同名互相覆盖
function docPath(doc) { return path.join(store.UPLOAD_DIR, doc.id + '.orig.' + doc.ext); }
function textPath(doc) { return path.join(store.UPLOAD_DIR, doc.id + '.txt'); }

async function upload(ctx) {
  const user = util.auth(ctx);
  const file = (ctx.parts || []).find((p) => p.filename);
  util.need(file, '请选择要上传的文件');
  const rawName = String(file.filename);
  const ext = (rawName.split('.').pop() || '').toLowerCase();
  util.need(parse.SUPPORTED.includes(ext), '目前支持 PDF / TXT / DOCX / MD 四种格式');
  const title = String((ctx.body && ctx.body.title) || rawName.replace(/\.[^.]+$/, '')).slice(0, 80);
  const doc = store.insert('documents', {
    userId: user.id, title, fileName: rawName.slice(0, 120), ext, bytes: file.data.length,
    parseStatus: 'pending', progressNote: '排队中', overview: '', chapterCount: 0, knowledgeCount: 0, difficultyCount: 0, version: 1
  });
  fs.writeFileSync(docPath(doc), file.data);
  const ex = parse.extract(docPath(doc), ext);
  if (!ex.ok) {
    try { fs.unlinkSync(docPath(doc)); } catch (e) { /* 文件不存在时忽略 */ }
    store.update('documents', (d) => d.id === doc.id, { parseStatus: 'failed', failReason: ex.reason, failDetail: ex.detail });
    return { document: store.one('documents', (d) => d.id === doc.id) };
  }
  fs.writeFileSync(textPath(doc), ex.text, 'utf8');
  store.update('documents', (d) => d.id === doc.id, { charCount: ex.charCount, scanned: !!ex.scanned, parseStatus: 'pending', progressNote: '准备分析' });
  util.async(() => workers.analyzeDocument(doc.id));
  return { document: store.one('documents', (d) => d.id === doc.id) };
}

async function listDocs(ctx) {
  const user = util.auth(ctx);
  return { list: store.find('documents', (d) => d.userId === user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
}

async function docDetail(ctx) {
  const user = util.auth(ctx);
  const d = store.one('documents', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(d, '资料不存在', 404);
  const chapters = store.find('docChapters', (c) => c.documentId === d.id).sort((a, b) => (a.orderNo || 0) - (b.orderNo || 0));
  const knowledge = store.find('docKnowledgePoints', (k) => k.documentId === d.id);
  const marks = store.find('difficultyMarks', (m) => m.documentId === d.id);
  const questions = store.find('diagnosticQuestions', (q) => q.documentId === d.id).map((q) => ({
    id: q.id, knowledgePoint: q.knowledgePoint, questionType: q.questionType, questionText: q.questionText, source: q.source
  }));
  const plans = store.find('studyPlans', (p) => p.userId === user.id && p.documentId === d.id).map((p) => ({ id: p.id, title: p.title, status: p.status, deadline: p.deadline }));
  return { document: d, chapters, knowledge, marks, questions, plans, truncated: !!d.truncated };
}

async function reanalyze(ctx) {
  const user = util.auth(ctx);
  const d = store.one('documents', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(d, '资料不存在', 404);
  util.need(fs.existsSync(textPath(d)), '这份资料没有可分析的文本，请重新上传');
  store.update('documents', (x) => x.id === d.id, { parseStatus: 'pending', failReason: '' });
  util.async(() => workers.analyzeDocument(d.id));
  return { ok: true };
}

async function difficultyFeedback(ctx) {
  const user = util.auth(ctx);
  const m = store.one('difficultyMarks', (x) => x.id === ctx.params.markId && x.userId === user.id);
  util.need(m, '难点不存在', 404);
  const type = ctx.body.type === 'missed' ? '标漏了' : '标错了';
  store.update('difficultyMarks', (x) => x.id === m.id, { feedback: type, source: '学生修正', feedbackAt: store.now() });
  store.insert('difficultyFeedbacks', { userId: user.id, markId: m.id, type, note: String(ctx.body.note || '').slice(0, 300) });
  return { ok: true };
}

async function download(ctx) {
  const user = util.auth(ctx);
  const d = store.one('documents', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(d, '资料不存在', 404);
  util.need(fs.existsSync(docPath(d)), '原文件已不在服务器上');
  return { __file: true, data: fs.readFileSync(docPath(d)), type: 'application/octet-stream', filename: d.fileName || (d.title + '.' + d.ext) };
}

async function removeDoc(ctx) {
  const user = util.auth(ctx);
  const d = store.one('documents', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(d, '资料不存在', 404);
  const plans = store.find('studyPlans', (p) => p.userId === user.id && p.documentId === d.id);
  for (const p of plans) {
    store.remove('studyTasks', (t) => t.planId === p.id);
    store.remove('taskAdjustments', (a) => a.planId === p.id);
    store.remove('studyPlans', (x) => x.id === p.id);
  }
  store.remove('docChapters', (c) => c.documentId === d.id);
  store.remove('docKnowledgePoints', (k) => k.documentId === d.id);
  store.remove('difficultyMarks', (m) => m.documentId === d.id);
  store.remove('diagnosticQuestions', (q) => q.documentId === d.id);
  store.remove('promptMaterials', (m) => m.userId === user.id && m.module === 'document_' + d.id);
  for (const p of [docPath(d), textPath(d)]) { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* 忽略 */ } }
  store.remove('documents', (x) => x.id === d.id);
  return { ok: true, removedPlans: plans.length };
}

/* ------------------------------- 学习计划 ------------------------------- */
async function createPlan(ctx) {
  const user = util.auth(ctx);
  const b = ctx.body || {};
  const time = store.one('timeConstraints', (t) => t.userId === user.id);
  const minutesPerDay = Number(b.minutesPerDay) || (time && time.minutesPerDay) || 0;
  const restDays = Array.isArray(b.restDays) ? b.restDays.map(Number) : (time ? time.restDays : []);
  util.need(minutesPerDay >= 15, '先告诉我每天大概能学多久（至少 15 分钟）');
  if (!time || time.minutesPerDay !== minutesPerDay || JSON.stringify(time.restDays || []) !== JSON.stringify(restDays)) {
    if (time) store.update('timeConstraints', (t) => t.userId === user.id, { minutesPerDay, restDays });
    else store.insert('timeConstraints', { userId: user.id, daysPerWeek: b.daysPerWeek || 5, minutesPerDay, restDays, preferredSlots: '', importantDates: '' });
  }
  const doc = b.documentId ? store.one('documents', (d) => d.id === b.documentId && d.userId === user.id) : null;
  if (b.documentId) util.need(doc, '资料不存在', 404);
  const chapters = doc ? store.find('docChapters', (c) => c.documentId === doc.id).sort((a, b2) => (a.orderNo || 0) - (b2.orderNo || 0)) : [];
  const knowledge = doc ? store.find('docKnowledgePoints', (k) => k.documentId === doc.id) : [];
  const marks = doc ? store.find('difficultyMarks', (m) => m.documentId === doc.id) : [];
  const goal = String(b.goal || (doc ? '学完《' + doc.title + '》' : '')).slice(0, 80);
  util.need(goal, '请填写这次的学习目标');
  const deadline = String(b.deadline || '').slice(0, 10);
  if (deadline) util.need(/^\d{4}-\d{2}-\d{2}$/.test(deadline) && new Date(deadline) > new Date(), '期望完成时间请填未来的日期');

  const res = await ai.chatJSON(prompts.planMessages({
    goal, deadline, minutesPerDay, restDays,
    chapters: chapters.map((c) => c.title), knowledgePoints: knowledge.map((k) => k.name),
    difficultyMarks: marks.map((m) => ({ chapter: m.chapter, level: m.level }))
  }), {
    purpose: 'create-plan', userId: user.id, maxTokens: 8192, temperature: 0.2,
    validate: (o) => (o && Array.isArray(o.units) && o.units.length ? [] : ['units 必须是非空数组'])
  });
  let units = res.ok ? res.data.units.slice(0, 60) : [];
  if (!units.length) {
    const base = chapters.length ? chapters.map((c) => c.title) : [goal];
    units = base.slice(0, 20).map((t) => ({
      title: '学习：' + t, action: '阅读资料', minutes: 30, chapter: t, knowledgePoints: [],
      completionCriteria: '能用三句话说出这一部分的主要内容', reason: '计划里还没有细分，先按章节推进'
    }));
  }
  const tasks = scheduler.buildSchedule(units, { startDate: util.today(), minutesPerDay, restDays });
  const plan = store.insert('studyPlans', {
    userId: user.id, documentId: doc ? doc.id : null, title: goal, goal, deadline,
    minutesPerDay, restDays, status: '进行中', source: doc ? '资料计划' : '综合计划',
    stages: chapters.slice(0, 20).map((c) => ({ title: c.title })), taskCount: tasks.length,
    checkpointEvery: 5, degraded: !res.ok
  });
  for (const t of tasks) {
    const topic = (t.knowledgePoints || [])[0] ? util.getOrCreateTopic(user.id, t.knowledgePoints[0]) : null;
    store.insert('studyTasks', Object.assign({ userId: user.id, planId: plan.id, documentId: doc ? doc.id : null, topicId: topic ? topic.id : null }, t));
    if (topic) {
      const st = store.one('knowledgeStates', (s) => s.userId === user.id && s.topicId === topic.id);
      if (!st) store.insert('knowledgeStates', { userId: user.id, topicId: topic.id, topicName: topic.name, state: '待学习', evidence: [] });
    }
  }
  return { plan: store.one('studyPlans', (p) => p.id === plan.id), taskCount: tasks.length, degraded: !res.ok };
}

async function listPlans(ctx) {
  const user = util.auth(ctx);
  const plans = store.find('studyPlans', (p) => p.userId === user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    list: plans.map((p) => {
      const tasks = store.find('studyTasks', (t) => t.planId === p.id);
      return Object.assign({}, p, {
        done: tasks.filter((t) => t.status === '已完成').length, total: tasks.length,
        today: tasks.filter((t) => t.plannedDate === util.today() && t.status !== '已完成').length
      });
    })
  };
}

async function planDetail(ctx) {
  const user = util.auth(ctx);
  const p = store.one('studyPlans', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(p, '计划不存在', 404);
  const tasks = store.find('studyTasks', (t) => t.planId === p.id).sort((a, b) => String(a.plannedDate).localeCompare(String(b.plannedDate)));
  const byDate = {};
  for (const t of tasks) { byDate[t.plannedDate] = byDate[t.plannedDate] || []; byDate[t.plannedDate].push(t); }
  const days = Object.keys(byDate).sort().map((d) => ({
    date: d, rest: false, tasks: byDate[d], totalMinutes: byDate[d].reduce((s, t) => s + (t.estimatedMinutes || 0), 0)
  }));
  const adjustments = store.find('taskAdjustments', (a) => a.planId === p.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 10);
  const doc = p.documentId ? store.one('documents', (d) => d.id === p.documentId) : null;
  return { plan: p, days, adjustments, document: doc ? { id: doc.id, title: doc.title } : null };
}

async function patchPlan(ctx) {
  const user = util.auth(ctx);
  const p = store.one('studyPlans', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(p, '计划不存在', 404);
  if (ctx.body.status && ['进行中', '已结束', '已归档'].includes(ctx.body.status)) {
    store.update('studyPlans', (x) => x.id === p.id, { status: ctx.body.status });
  }
  if (ctx.body.deadline !== undefined) {
    const d = String(ctx.body.deadline).slice(0, 10);
    if (d) util.need(/^\d{4}-\d{2}-\d{2}$/.test(d), '日期格式不正确');
    store.update('studyPlans', (x) => x.id === p.id, { deadline: d });
  }
  return { plan: store.one('studyPlans', (x) => x.id === p.id) };
}

async function deletePlan(ctx) {
  const user = util.auth(ctx);
  const p = store.one('studyPlans', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(p, '计划不存在', 404);
  store.remove('studyTasks', (t) => t.planId === p.id);
  store.remove('taskAdjustments', (a) => a.planId === p.id);
  store.remove('studyPlans', (x) => x.id === p.id);
  return { ok: true };
}

async function reschedule(ctx) {
  const user = util.auth(ctx);
  const p = store.one('studyPlans', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(p, '计划不存在', 404);
  const tasks = store.find('studyTasks', (t) => t.planId === p.id);
  const before = tasks.map((t) => ({ id: t.id, date: t.plannedDate }));
  const { changes } = scheduler.reschedulePending(tasks, {
    startDate: util.today(), minutesPerDay: p.minutesPerDay, restDays: p.restDays
  });
  for (const t of tasks) store.update('studyTasks', (x) => x.id === t.id, { plannedDate: t.plannedDate, status: t.status });
  let note = '';
  if (changes.length) {
    const res = await ai.chatJSON(prompts.rescheduleMessages({
      changes: changes.map((c) => c.title + '：' + c.from + ' → ' + c.to).join('；')
    }), { purpose: 'reschedule-note', userId: user.id, maxTokens: 1024, validate: (o) => (o && o.text ? [] : ['缺少 text']) });
    note = res.ok ? String(res.data.text).slice(0, 200) : '已按你现在的可用时间把后面的任务重新排了一遍。';
  } else {
    note = '现在的安排已经合适，不需要调整。';
  }
  const adj = store.insert('taskAdjustments', { userId: user.id, planId: p.id, changes, note, trigger: String(ctx.body.reason || '手动重排'), before });
  return { ok: true, changes, note, adjustment: adj };
}

async function exportPlan(ctx) {
  const user = util.auth(ctx);
  const p = store.one('studyPlans', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(p, '计划不存在', 404);
  const tasks = store.find('studyTasks', (t) => t.planId === p.id).sort((a, b) => String(a.plannedDate).localeCompare(String(b.plannedDate)));
  const text = [
    '# 学习计划：' + p.title,
    '目标：' + p.goal,
    p.deadline ? '期望完成：' + p.deadline : '',
    '每天可投入：' + p.minutesPerDay + ' 分钟',
    '',
    ...tasks.map((t) => '- ' + t.plannedDate + '｜' + t.title + '（' + t.estimatedMinutes + ' 分钟，' + t.status + '）\n  完成标准：' + t.completionCriteria)
  ].filter(Boolean).join('\n');
  return { __text: true, data: text };
}

module.exports = {
  'POST /api/documents': upload,
  'GET /api/documents': listDocs,
  'GET /api/documents/:id': docDetail,
  'POST /api/documents/:id/analyze': reanalyze,
  'POST /api/documents/:id/difficulty/:markId/feedback': difficultyFeedback,
  'GET /api/documents/:id/file': download,
  'DELETE /api/documents/:id': removeDoc,
  'POST /api/plans': createPlan,
  'GET /api/plans': listPlans,
  'GET /api/plans/:id': planDetail,
  'PATCH /api/plans/:id': patchPlan,
  'DELETE /api/plans/:id': deletePlan,
  'POST /api/plans/:id/reschedule': reschedule,
  'GET /api/plans/:id/export': exportPlan
};
