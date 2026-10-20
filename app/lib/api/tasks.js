'use strict';
// N-01 每日任务与执行、N-02 成长记录与知识点状态、F-10 每日学习建议
const store = require('../store');
const ai = require('../ai');
const prompts = require('../prompts');
const util = require('./util');
const workers = require('../../workers');
const scheduler = require('../scheduler');

const REASONS = ['时间不够', '内容太难', '资料不清楚', '临时有事', '其他'];
const WRONG_REASONS = ['概念不清', '计算失误', '审题偏差', '步骤遗漏', '看错条件', '其他'];

function topicOf(userId, name) { return util.getOrCreateTopic(userId, name); }

/* --------------------------- 知识点状态（规则驱动） --------------------------- */
function applyState(userId, topicId, topicName, record) {
  let st = store.one('knowledgeStates', (s) => s.userId === userId && s.topicId === topicId);
  if (!st) st = store.insert('knowledgeStates', { userId, topicId, topicName, state: '未诊断', evidence: [] });
  const evidence = (st.evidence || []).concat([{ type: record.recordType, result: record.result, wrongReason: record.wrongReason || '', at: record.createdAt }]).slice(-8);
  const recent = evidence.slice(-3);
  let state = st.state === '未诊断' ? '待学习' : st.state;
  if (record.recordType === '练习结果' || record.recordType === '自测') {
    if (record.result === '错误') state = '需复习';
    else if (record.result === '部分正确') state = '学习中';
    else if (record.result === '正确') state = recent.filter((e) => e.result === '正确').length >= 2 ? '有近期正确表现' : '学习中';
  } else if (record.recordType === '理解反馈') {
    state = record.result === '仍然不理解' ? '需复习' : '学习中';
  } else if (record.recordType === '任务完成') {
    if (state === '未诊断' || state === '待学习') state = '学习中';
  }
  store.update('knowledgeStates', (s) => s.id === st.id, { state, evidence, updatedAt: store.now() });
  return { id: st.id, state, evidenceCount: evidence.length };
}

/* --------------------------------- 今日 --------------------------------- */
async function today(ctx) {
  const user = util.auth(ctx);
  const date = ctx.query.date || util.today();
  const time = store.one('timeConstraints', (t) => t.userId === user.id);
  const restDays = time ? time.restDays || [] : [];
  const restToday = util.isRestDay(date, restDays);
  const tasks = store.find('studyTasks', (t) => t.userId === user.id && t.plannedDate === date)
    .sort((a, b) => (a.priority === '高' ? -1 : 1));
  let suggestion = store.one('suggestions', (s) => s.userId === user.id && s.date === date);
  if (!suggestion && !ctx.query.nosuggest) suggestion = await workers.generateSuggestion(user.id, date);
  const overdue = store.find('studyTasks', (t) => t.userId === user.id && t.plannedDate < date && (t.status === '待开始' || t.status === '需调整'));
  const planIds = Array.from(new Set(tasks.map((t) => t.planId)));
  const plans = planIds.map((id) => store.one('studyPlans', (p) => p.id === id)).filter(Boolean)
    .map((p) => ({ id: p.id, title: p.title, deadline: p.deadline, minutesPerDay: p.minutesPerDay }));
  return {
    date, restToday, tasks, suggestion, plans,
    overdueCount: overdue.length,
    doneToday: tasks.filter((t) => t.status === '已完成').length,
    minutesToday: tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0),
    hasTime: !!time
  };
}

async function listTasks(ctx) {
  const user = util.auth(ctx);
  let list = store.find('studyTasks', (t) => t.userId === user.id);
  if (ctx.query.date) list = list.filter((t) => t.plannedDate === ctx.query.date);
  if (ctx.query.planId) list = list.filter((t) => t.planId === ctx.query.planId);
  if (ctx.query.status) list = list.filter((t) => t.status === ctx.query.status);
  return { list: list.sort((a, b) => String(a.plannedDate).localeCompare(String(b.plannedDate))) };
}

async function addTask(ctx) {
  const user = util.auth(ctx);
  const title = String((ctx.body || {}).title || '').trim();
  util.need(title, '请写下要做的事');
  const t = store.insert('studyTasks', {
    userId: user.id, planId: ctx.body.planId || null, documentId: ctx.body.documentId || null,
    title: title.slice(0, 100), actionType: '阅读资料', estimatedMinutes: Number(ctx.body.estimatedMinutes) || 30,
    plannedDate: String(ctx.body.plannedDate || util.today()).slice(0, 10),
    completionCriteria: String(ctx.body.completionCriteria || '完成这件事本身').slice(0, 200),
    reason: String(ctx.body.reason || '你自己添加的'), chapter: '', knowledgePoints: [], priority: '中', status: '待开始', source: '学生手动添加'
  });
  return { task: t };
}

async function patchTask(ctx) {
  const user = util.auth(ctx);
  const t = store.one('studyTasks', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(t, '任务不存在', 404);
  const b = ctx.body || {};
  const status = b.status;
  util.need(['待开始', '进行中', '已完成', '需调整', '跳过'].includes(status), '状态不正确');
  const patch = { status };
  let reschedule = null;

  if (status === '已完成') {
    patch.completedAt = store.now();
    const topicId = t.topicId || ((t.knowledgePoints || []).length ? topicOf(user.id, t.knowledgePoints[0]).id : null);
    if (topicId) {
      const rec = store.insert('learningRecords', {
        userId: user.id, taskId: t.id, topicIds: [topicId], topicName: (t.knowledgePoints || [])[0] || t.title,
        recordType: '任务完成', source: '任务执行', result: '完成', wrongReason: '', feedback: ''
      });
      applyState(user.id, topicId, rec.topicName, rec);
    }
  }
  if (status === '需调整') {
    const reason = REASONS.includes(b.reason) ? b.reason : '未说明';
    patch.adjustReason = reason;
    patch.adjustAt = store.now();
    if (t.planId) {
      const plan = store.one('studyPlans', (p) => p.id === t.planId);
      const all = store.find('studyTasks', (x) => x.planId === t.planId);
      const target = all.find((x) => x.id === t.id);
      if (target) target.status = '需调整';
      const { changes } = scheduler.reschedulePending(all, { startDate: util.today(), minutesPerDay: plan.minutesPerDay, restDays: plan.restDays });
      for (const x of all) store.update('studyTasks', (y) => y.id === x.id, { plannedDate: x.plannedDate, status: x.status });
      const noteRes = await ai.chatJSON(prompts.rescheduleMessages({
        changes: changes.map((c) => c.title + '：' + c.from + ' → ' + c.to).join('；') || '任务顺延'
      }), { purpose: 'reschedule-note', userId: user.id, maxTokens: 1024, validate: (o) => (o && o.text ? [] : ['缺少 text']) });
      const note = noteRes.ok ? String(noteRes.data.text).slice(0, 200) : '已把后面的安排按你现在的节奏重新排了一下。';
      store.insert('taskAdjustments', { userId: user.id, planId: t.planId, changes, note, trigger: '暂时做不到：' + reason, before: [] });
      reschedule = { changes, note };
    }
  }
  if (status === '跳过' && t.planId) {
    const plan = store.one('studyPlans', (p) => p.id === t.planId);
    const all = store.find('studyTasks', (x) => x.planId === t.planId);
    const target = all.find((x) => x.id === t.id);
    if (target) target.status = '跳过';
    const { changes } = scheduler.reschedulePending(all, { startDate: util.today(), minutesPerDay: plan.minutesPerDay, restDays: plan.restDays });
    for (const x of all) store.update('studyTasks', (y) => y.id === x.id, { plannedDate: x.plannedDate, status: x.status });
    if (changes.length) {
      const note = '这条先放一放，后面的安排已经顺延。';
      store.insert('taskAdjustments', { userId: user.id, planId: t.planId, changes, note, trigger: '跳过', before: [] });
      reschedule = { changes, note };
    }
  }
  store.update('studyTasks', (x) => x.id === t.id, patch);
  return { task: store.one('studyTasks', (x) => x.id === t.id), reschedule };
}

async function editTask(ctx) {
  const user = util.auth(ctx);
  const t = store.one('studyTasks', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(t, '任务不存在', 404);
  const patch = {};
  if (ctx.body.title) patch.title = String(ctx.body.title).slice(0, 100);
  if (ctx.body.plannedDate) patch.plannedDate = String(ctx.body.plannedDate).slice(0, 10);
  if (ctx.body.estimatedMinutes) patch.estimatedMinutes = Math.max(5, Math.min(600, Number(ctx.body.estimatedMinutes)));
  if (ctx.body.priority && ['高', '中', '低'].includes(ctx.body.priority)) patch.priority = ctx.body.priority;
  if (ctx.body.completionCriteria) patch.completionCriteria = String(ctx.body.completionCriteria).slice(0, 200);
  store.update('studyTasks', (x) => x.id === t.id, patch);
  return { task: store.one('studyTasks', (x) => x.id === t.id) };
}

/* ------------------------------- 成长记录 ------------------------------- */
async function listRecords(ctx) {
  const user = util.auth(ctx);
  const limit = Math.min(100, Number(ctx.query.limit) || 30);
  const list = store.find('learningRecords', (r) => r.userId === user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { list: list.slice(0, limit), total: list.length };
}

async function addRecord(ctx) {
  const user = util.auth(ctx);
  const b = ctx.body || {};
  const task = b.taskId ? store.one('studyTasks', (t) => t.id === b.taskId && t.userId === user.id) : null;
  const topicName = String(b.topicName || (task && (task.knowledgePoints || [])[0]) || '').trim();
  util.need(task || topicName, '请说明这条记录对应哪个任务或知识点');
  const topic = topicOf(user.id, topicName || task.title);
  const rec = store.insert('learningRecords', {
    userId: user.id, taskId: task ? task.id : null, topicIds: [topic.id], topicName: topic.name,
    recordType: ['练习结果', '理解反馈', '任务完成', '错因归类', '手动标记', '自测'].includes(b.recordType) ? b.recordType : '手动标记',
    source: b.source || '辅导练习',
    result: ['正确', '部分正确', '错误', '未作答', '完成', '仍然不理解', '我理解了', '不适用'].includes(b.result) ? b.result : '不适用',
    wrongReason: REASONS.concat(WRONG_REASONS).includes(b.wrongReason) ? b.wrongReason : '',
    confidence: Number(b.confidence) || 0, feedback: String(b.feedback || '').slice(0, 500),
    questionId: b.questionId || null
  });
  const st = applyState(user.id, topic.id, topic.name, rec);
  return { record: rec, state: st };
}

async function removeRecord(ctx) {
  const user = util.auth(ctx);
  const rec = store.one('learningRecords', (r) => r.id === ctx.params.id && r.userId === user.id);
  util.need(rec, '记录不存在', 404);
  store.remove('learningRecords', (r) => r.id === rec.id);
  for (const tid of rec.topicIds || []) {
    const st = store.one('knowledgeStates', (s) => s.userId === user.id && s.topicId === tid);
    if (st) {
      const evidence = (st.evidence || []).filter((e) => e.at !== rec.createdAt);
      store.update('knowledgeStates', (s) => s.id === st.id, { evidence, state: evidence.length ? st.state : '未诊断' });
    }
  }
  return { ok: true };
}

async function knowledgeStates(ctx) {
  const user = util.auth(ctx);
  const list = store.find('knowledgeStates', (s) => s.userId === user.id)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  const records = store.find('learningRecords', (r) => r.userId === user.id);
  return {
    list: list.map((s) => Object.assign({}, s, {
      recordCount: records.filter((r) => (r.topicIds || []).includes(s.topicId)).length
    })),
    notice: '这些状态来自你在平台里的练习与反馈记录，不代表能力评价。'
  };
}

async function patchState(ctx) {
  const user = util.auth(ctx);
  const s = store.one('knowledgeStates', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(s, '记录不存在', 404);
  if (ctx.body.clear) {
    store.update('knowledgeStates', (x) => x.id === s.id, { state: '未诊断', evidence: [], clearedAt: store.now() });
  } else if (ctx.body.state && ['未诊断', '待学习', '学习中', '需复习', '有近期正确表现'].includes(ctx.body.state)) {
    store.update('knowledgeStates', (x) => x.id === s.id, { state: ctx.body.state, manual: true });
  }
  return { state: store.one('knowledgeStates', (x) => x.id === s.id) };
}

async function recordSummary(ctx) {
  const user = util.auth(ctx);
  const records = store.find('learningRecords', (r) => r.userId === user.id).slice(-15).map((r) => ({ topic: r.topicName, type: r.recordType, result: r.result, wrong: r.wrongReason }));
  const states = store.find('knowledgeStates', (s) => s.userId === user.id).map((s) => ({ topic: s.topicName, state: s.state }));
  const res = await ai.chatJSON(prompts.recordSummaryMessages({ records, states }), {
    purpose: 'record-summary', userId: user.id, maxTokens: 4096,
    validate: (o) => (o && typeof o.summary === 'string' ? [] : ['缺少 summary'])
  });
  if (!res.ok) return { ok: false, error: '摘要暂时生成不出来，记录本身还在' };
  return {
    ok: true, summary: String(res.data.summary).slice(0, 600),
    points: (res.data.points || []).slice(0, 10).map((p) => ({ topic: String(p.topic || '').slice(0, 60), state: String(p.state || '').slice(0, 20), suggestion: String(p.suggestion || '').slice(0, 200) }))
  };
}

/* ------------------------------ F-10 每日建议 ------------------------------ */
async function todaySuggestion(ctx) {
  const user = util.auth(ctx);
  const s = await workers.generateSuggestion(user.id, util.today());
  return { suggestion: s, notice: '选择休息不会有任何影响。' };
}

async function suggestionFeedback(ctx) {
  const user = util.auth(ctx);
  const s = store.one('suggestions', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(s, '建议不存在', 404);
  const type = ctx.body.type;
  util.need(['done', 'rest', 'notinterested'].includes(type), '反馈类型不正确');
  const map = { done: '已学', rest: '已休息', notinterested: '不感兴趣' };
  store.update('suggestions', (x) => x.id === s.id, { status: map[type], respondedAt: store.now() });
  store.insert('suggestionFeedbacks', { userId: user.id, suggestionId: s.id, date: s.date, type });

  let extra = null;
  if (type === 'done' && s.related && s.related.taskTitle) {
    const t = store.find('studyTasks', (x) => x.userId === user.id && x.plannedDate === s.date && x.title === s.related.taskTitle)[0];
    if (t && t.status !== '已完成') {
      store.update('studyTasks', (x) => x.id === t.id, { status: '已完成', completedAt: store.now() });
      const rec = store.insert('learningRecords', {
        userId: user.id, taskId: t.id, topicIds: t.topicId ? [t.topicId] : [], topicName: (t.knowledgePoints || [])[0] || t.title,
        recordType: '任务完成', source: '每日建议', result: '完成', wrongReason: '', feedback: ''
      });
      if (t.topicId) applyState(user.id, t.topicId, rec.topicName, rec);
      extra = { taskCompleted: t.id };
    }
  }
  if (type === 'rest') {
    const tasks = store.find('studyTasks', (t) => t.userId === user.id && t.plannedDate === s.date && t.status !== '已完成');
    const tomorrow = util.addDays(s.date, 1);
    const restDays = (store.one('timeConstraints', (x) => x.userId === user.id) || {}).restDays || [];
    for (const t of tasks) store.update('studyTasks', (x) => x.id === t.id, { plannedDate: util.nextWorkday(tomorrow, restDays), status: '待开始' });
    extra = { movedTasks: tasks.length, toDate: tomorrow };
  }
  if (type === 'notinterested') {
    const task = store.find('studyTasks', (x) => x.userId === user.id && x.title === (s.related && s.related.taskTitle))[0] || {};
    const name = ((task.knowledgePoints || [])[0]) || s.type || '未指定';
    store.insert('topicPreferences', { userId: user.id, topic: String(name).slice(0, 60), until: new Date(Date.now() + 30 * 864e5).toISOString() });
  }
  return { suggestion: store.one('suggestions', (x) => x.id === s.id), extra };
}

async function withdrawFeedback(ctx) {
  const user = util.auth(ctx);
  const s = store.one('suggestions', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(s, '建议不存在', 404);
  store.update('suggestions', (x) => x.id === s.id, { status: '待响应', respondedAt: null });
  store.remove('suggestionFeedbacks', (f) => f.suggestionId === s.id);
  return { ok: true };
}

async function suggestionHistory(ctx) {
  const user = util.auth(ctx);
  const list = store.find('suggestions', (s) => s.userId === user.id).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 60);
  const feedbacks = store.find('suggestionFeedbacks', (f) => f.userId === user.id);
  return { list: list.map((s) => Object.assign({}, s, { feedback: (feedbacks.find((f) => f.suggestionId === s.id) || {}).type || '' })) };
}

module.exports = {
  'GET /api/today': today,
  'GET /api/tasks': listTasks,
  'POST /api/tasks': addTask,
  'PATCH /api/tasks/:id': patchTask,
  'PATCH /api/tasks/:id/edit': editTask,
  'GET /api/records': listRecords,
  'POST /api/records': addRecord,
  'DELETE /api/records/:id': removeRecord,
  'GET /api/knowledge-states': knowledgeStates,
  'PATCH /api/knowledge-states/:id': patchState,
  'POST /api/records/summary': recordSummary,
  'GET /api/suggestions/today': todaySuggestion,
  'GET /api/suggestions/history': suggestionHistory,
  'POST /api/suggestions/:id/feedback': suggestionFeedback,
  'DELETE /api/suggestions/:id/feedback': withdrawFeedback
};
