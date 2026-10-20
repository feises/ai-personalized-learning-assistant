'use strict';
// F-03 搜题（文字 / 图像）、F-04 解答结构与防抄约束、F-08 会话独立性、搜题统计
const store = require('../store');
const ai = require('../ai');
const prompts = require('../prompts');
const util = require('./util');

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const SKIP_STEP = /易得|显然|由计算可知|同理可得|略/;

/* ----------------------- F-04“只给答案”诉求识别（仅记录，不改变行为） ----------------------- */
function detectBypass(text) {
  const t = String(text || '');
  if (!t) return null;
  if (/只(要|给|显示|输出)?\s*(最终)?\s*答案|不要(过程|步骤|推导)|别写(过程|步骤)|直接(给|告诉)(结果|答案)/.test(t)) return 'BY-01 直接指令';
  if (/(来不及|赶时间|明天(就)?考|要交|着急|急用)/.test(t) && /(答案|结果)/.test(t)) return 'BY-02 理由包装';
  if (/(假设你|你现在是|扮演|作为一个(只|仅)|从现在起你是)/.test(t)) return 'BY-03 角色扮演';
  if (/(忽略(之前|上面|前面)|新的规则|忘记(你的)?(设定|规则)|覆盖(你的)?(设定|规则))/.test(t)) return 'BY-04 规则覆盖';
  if (/(代码块|表格|json)[^。\n]{0,12}(只|仅)/.test(t)) return 'BY-05 格式欺骗';
  if (/第\s*[0-9一二三四五六七八九]+\s*步[^。\n]{0,8}(单独|只)/.test(t)) return 'BY-07 多轮渐进';
  if (/(检查|看看)[^。\n]{0,10}(格式|对不对)[^。\n]{0,10}(只|仅)/.test(t)) return 'BY-08 伪装成其他任务';
  if (/(只|仅)(发|给)(我)?[^。\n]{0,8}第\s*[0-9一二三四五六七八九]+\s*步/.test(t)) return 'BY-09 分段索取';
  if (/(假设我(已经)?会了|假设我(已经)?做完|假装我(已经)?)/.test(t)) return 'BY-10 情境假设';
  if (/(差评|投诉|我就走|不给我就)/.test(t)) return 'BY-11 情绪施压';
  return null;
}

function validImages(images) {
  const list = Array.isArray(images) ? images : [];
  util.need(list.length <= MAX_IMAGES, '一次最多上传 ' + MAX_IMAGES + ' 张图片');
  const parts = [];
  for (const img of list) {
    const b64 = String(img.base64 || '').replace(/^data:[^,]+,/, '');
    util.need(b64.length > 50, '图片内容为空');
    util.need(Buffer.from(b64, 'base64').length <= MAX_IMAGE_BYTES, '单张图片请控制在 6MB 以内');
    parts.push(ai.imagePart(img.mime || 'image/png', Buffer.from(b64, 'base64')));
  }
  return parts;
}

function taskContext(userId, taskId) {
  if (!taskId) return null;
  const task = store.one('studyTasks', (t) => t.id === taskId && t.userId === userId);
  if (!task) return null;
  let excerpt = '';
  if (task.chapter && task.documentId) {
    const ch = store.one('docChapters', (c) => c.documentId === task.documentId && c.title === task.chapter);
    if (ch) excerpt = [ch.summary].concat(ch.concepts || []).join('；');
  }
  const kp = (task.knowledgePoints || [])[0] || '';
  return {
    taskId: task.id, taskTitle: task.title, criteria: task.completionCriteria, knowledge: kp, excerpt,
    carried: ['task.title', 'task.completionCriteria', 'knowledgePoint', 'chapter.excerpt', 'profile.major', 'profile.grade']
  };
}

function validateAnswer(o) {
  const errs = [];
  if (!o || typeof o !== 'object') return ['输出不是对象'];
  for (const k of ['understanding', 'approach', 'answer']) {
    if (!o[k] || String(o[k]).trim().length < 4) errs.push(k + ' 缺失或过短');
  }
  if (!Array.isArray(o.knowledgePoints) || !o.knowledgePoints.length) errs.push('knowledgePoints 必须是非空数组');
  if (!Array.isArray(o.steps) || o.steps.length < 2) errs.push('steps 至少要有两步');
  else if (o.steps.some((s) => !s || !s.title || !s.detail || String(s.detail).trim().length < 8)) errs.push('每一步都要有 title 与足够的 detail');
  else if (o.steps.some((s) => SKIP_STEP.test(String(s.detail).slice(0, 12)) && String(s.detail).length < 30)) errs.push('不得用「易得」「显然」这类表述跳过步骤');
  if (!Array.isArray(o.pitfalls) || !o.pitfalls.length) errs.push('pitfalls 必须是非空数组');
  return errs;
}

function fallbackAnswer(reason) {
  return {
    understanding: '这道题的内容暂时没有生成成功，请点下面的「重新生成」再试一次。',
    knowledgePoints: ['待补充'], approach: '（本次生成异常，已记录）',
    steps: [{ title: '生成异常', detail: '系统已记录这次异常，重新生成通常即可恢复。' }, { title: '你可以这样做', detail: '把题目关键条件补充一句，或换一张更清晰的图片再提交。' }],
    answer: '（未生成）', verify: '（未生成）', pitfalls: ['（未生成）'],
    degraded: true, degradedReason: reason || '模型输出未通过结构校验'
  };
}

async function solve(ctx) {
  const user = util.auth(ctx);
  const b = ctx.body || {};
  const images = validImages(b.images);
  const question = String(b.question || '').slice(0, 8000);
  const supplement = String(b.supplement || '').slice(0, 500);
  util.need(question.trim() || images.length, '请输入题目，或上传一张题目图片');

  const ctxTask = taskContext(user.id, b.taskId);
  const profile = util.aiContext(user.id);
  const bypass = detectBypass(question + ' ' + supplement);

  const session = store.insert('tutorSessions', {
    userId: user.id, taskId: ctxTask ? ctxTask.taskId : null,
    carriedContext: ctxTask ? ctxTask.carried : ['profile.major', 'profile.grade'],
    carriedMemory: false, startedAt: store.now()
  });
  const record = store.insert('questionRecords', {
    userId: user.id, sessionId: session.id, inputType: images.length ? (question.trim() ? '文字+图像' : '图像') : '文字',
    questionText: question, imageCount: images.length, supplement,
    status: 'solving', subject: '', knowledgeTopic: '', difficulty: '', questionType: '',
    annotationSource: '', annotationConfidence: 0, topicIds: [], followups: 0, resolved: '',
    taskId: ctxTask ? ctxTask.taskId : null, formatRetried: false, degraded: false
  });
  store.insert('questionMessages', { sessionId: session.id, userId: user.id, role: 'user', content: question || '（图片题目）' });
  if (bypass) store.insert('answerRequestLogs', { userId: user.id, questionRecordId: record.id, bypassType: bypass, rawText: question.slice(0, 500) });

  const res = await ai.chatJSON(prompts.solveMessages({ question, supplement, profile, contextImages: images, context: ctxTask }), {
    purpose: 'solve', userId: user.id, maxTokens: 8192, temperature: 0.3, validate: validateAnswer,
    model: images.length ? ai.readConfig().visionModel : ai.readConfig().model
  });

  let answer;
  let degraded = false;
  if (res.ok) {
    const d = res.data;
    answer = {
      understanding: String(d.understanding).slice(0, 2000),
      knowledgePoints: (d.knowledgePoints || []).slice(0, 10).map((x) => String(x).slice(0, 60)),
      approach: String(d.approach).slice(0, 2000),
      steps: (d.steps || []).slice(0, 20).map((s) => ({ title: String(s.title).slice(0, 80), detail: String(s.detail).slice(0, 1500) })),
      answer: String(d.answer).slice(0, 1500),
      verify: String(d.verify || '').slice(0, 800),
      pitfalls: (d.pitfalls || []).slice(0, 8).map((x) => String(x).slice(0, 200))
    };
    const topic = util.getOrCreateTopic(user.id, d.knowledgeTopic || d.subject || '未归类');
    const short = (v, n, fallback) => {
      let s = String(v || '').replace(/[（(][^）)]{0,40}[）)]/g, '').trim();
      if (!s || /未(确定|标注|知)/.test(s)) s = fallback;
      return s.slice(0, n);
    };
    store.update('questionRecords', (r) => r.id === record.id, {
      status: 'done', subject: short(d.subject, 20, '未标注'),
      knowledgeTopic: short(d.knowledgeTopic, 40, '未标注'),
      difficulty: ['基础', '中等', '较难', '困难'].includes(d.difficulty) ? d.difficulty : '中等',
      questionType: short(d.questionType, 20, '其他'),
      annotationSource: 'AI 自动标注', annotationConfidence: Number(d.confidence) || 0,
      topicIds: [topic.id], answer
    });
  } else {
    degraded = true;
    answer = fallbackAnswer(res.error);
    store.update('questionRecords', (r) => r.id === record.id, { status: 'failed', degraded: true, answer });
  }
  store.insert('questionMessages', { sessionId: session.id, userId: user.id, role: 'assistant', content: JSON.stringify(answer) });
  store.update('tutorSessions', (s) => s.id === session.id, { lastActiveAt: store.now() });

  return { record: store.one('questionRecords', (r) => r.id === record.id), degraded };
}

async function imageExtract(ctx) {
  const user = util.auth(ctx);
  const images = validImages((ctx.body || {}).images);
  util.need(images.length, '请先选择图片');
  const res = await ai.chatJSON(prompts.imageExtractMessages(images), {
    purpose: 'image-extract', userId: user.id, maxTokens: 2000, model: ai.readConfig().visionModel,
    validate: (o) => (o && typeof o.detected === 'boolean' ? [] : ['缺少 detected 字段'])
  });
  if (!res.ok) return { ok: false, error: '图片识别没有完成：' + (res.error || '请重试') };
  return { ok: true, detected: !!res.data.detected, questionText: String(res.data.questionText || '').slice(0, 6000), note: String(res.data.note || '').slice(0, 300) };
}

async function followup(ctx) {
  const user = util.auth(ctx);
  const rec = store.one('questionRecords', (r) => r.id === ctx.params.id && r.userId === user.id);
  util.need(rec, '记录不存在', 404);
  const question = String((ctx.body || {}).question || '').trim();
  util.need(question, '请输入你想追问的内容');
  util.need(question.length <= 1000, '追问内容太长了');
  const bypass = detectBypass(question);
  if (bypass) store.insert('answerRequestLogs', { userId: user.id, questionRecordId: rec.id, bypassType: bypass, rawText: question.slice(0, 500) });

  const context = '题目：' + (rec.questionText || '（图片题）') + '\n解答要点：' +
    ((rec.answer && rec.answer.steps ? rec.answer.steps.map((s) => s.title).join('；') : '')) +
    '\n最终结论：' + ((rec.answer && rec.answer.answer) || '');
  const res = await ai.chatJSON(prompts.chatReplyMessages({ question, context }), {
    purpose: 'solve-followup', userId: user.id, maxTokens: 4096,
    validate: (o) => (o && typeof o.reply === 'string' && o.reply.trim().length > 1 ? [] : ['缺少 reply'])
  });
  store.insert('questionMessages', { sessionId: rec.sessionId, userId: user.id, role: 'user', content: question });
  if (!res.ok) return { ok: false, error: '回答没有生成成功，请再试一次' };
  store.update('questionRecords', (r) => r.id === rec.id, { followups: (rec.followups || 0) + 1 });
  store.insert('questionMessages', { sessionId: rec.sessionId, userId: user.id, role: 'assistant', content: res.data.reply });
  return { ok: true, reply: String(res.data.reply).slice(0, 3000), followups: (res.data.followups || []).slice(0, 3).map((x) => String(x).slice(0, 60)) };
}

async function history(ctx) {
  const user = util.auth(ctx);
  const limit = Math.min(50, Number(ctx.query.limit) || 20);
  const offset = Number(ctx.query.offset) || 0;
  let list = store.find('questionRecords', (r) => r.userId === user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (ctx.query.subject) list = list.filter((r) => r.subject === ctx.query.subject);
  if (ctx.query.q) list = list.filter((r) => (r.questionText || '').includes(ctx.query.q));
  return {
    total: list.length,
    list: list.slice(offset, offset + limit).map((r) => ({
      id: r.id, createdAt: r.createdAt, inputType: r.inputType, questionText: r.questionText.slice(0, 200),
      subject: r.subject, difficulty: r.difficulty, knowledgeTopic: r.knowledgeTopic, questionType: r.questionType,
      annotationSource: r.annotationSource, followups: r.followups, resolved: r.resolved, status: r.status
    }))
  };
}

async function detail(ctx) {
  const user = util.auth(ctx);
  const rec = store.one('questionRecords', (r) => r.id === ctx.params.id && r.userId === user.id);
  util.need(rec, '记录不存在', 404);
  const messages = store.find('questionMessages', (m) => m.sessionId === rec.sessionId)
    .map((m) => ({ role: m.role, content: m.role === 'assistant' && m.content.startsWith('{') ? '' : m.content, at: m.createdAt }))
    .filter((m) => m.content);
  return { record: rec, messages };
}

async function patchAnnotation(ctx) {
  const user = util.auth(ctx);
  const rec = store.one('questionRecords', (r) => r.id === ctx.params.id && r.userId === user.id);
  util.need(rec, '记录不存在', 404);
  const b = ctx.body || {};
  const patch = { annotationSource: '学生手动修正' };
  if (b.subject !== undefined) patch.subject = String(b.subject).slice(0, 40);
  if (b.difficulty !== undefined) patch.difficulty = ['基础', '中等', '较难', '困难'].includes(b.difficulty) ? b.difficulty : rec.difficulty;
  if (b.questionType !== undefined) patch.questionType = String(b.questionType).slice(0, 20);
  if (b.knowledgeTopic !== undefined) {
    const name = String(b.knowledgeTopic).slice(0, 80);
    patch.knowledgeTopic = name;
    patch.topicIds = [util.getOrCreateTopic(user.id, name).id];
  }
  if (b.resolved !== undefined) patch.resolved = ['已解决', '未解决', ''].includes(b.resolved) ? b.resolved : rec.resolved;
  if (b.annotationConfidence === undefined) patch.annotationConfidence = rec.annotationConfidence;
  store.update('questionRecords', (r) => r.id === rec.id, patch);
  return { record: store.one('questionRecords', (r) => r.id === rec.id) };
}

async function removeRecord(ctx) {
  const user = util.auth(ctx);
  const rec = store.one('questionRecords', (r) => r.id === ctx.params.id && r.userId === user.id);
  util.need(rec, '记录不存在', 404);
  store.remove('questionMessages', (m) => m.sessionId === rec.sessionId);
  store.remove('tutorSessions', (s) => s.id === rec.sessionId);
  store.remove('answerRequestLogs', (l) => l.questionRecordId === rec.id);
  store.remove('questionRecords', (r) => r.id === rec.id);
  return { ok: true };
}

function rangeStart(range) {
  const now = new Date();
  if (range === '7') return new Date(now.getTime() - 6 * 864e5);
  if (range === '30') return new Date(now.getTime() - 29 * 864e5);
  if (range === 'term') return new Date(now.getTime() - 150 * 864e5);
  return null;
}

async function stats(ctx) {
  const user = util.auth(ctx);
  const range = ['7', '30', 'term', 'all'].includes(ctx.query.range) ? ctx.query.range : 'all';
  const start = rangeStart(range);
  const list = store.find('questionRecords', (r) => r.userId === user.id && (!start || new Date(r.createdAt) >= start));
  const subjects = {};
  const difficulties = { 基础: 0, 中等: 0, 较难: 0, 困难: 0 };
  const topicsBySubject = {};
  const annotated = list.filter((r) => r.status === 'done');
  for (const r of annotated) {
    const s = r.subject || '未标注';
    subjects[s] = (subjects[s] || 0) + 1;
    if (difficulties[r.difficulty] !== undefined) difficulties[r.difficulty]++;
    topicsBySubject[s] = topicsBySubject[s] || {};
    const t = r.knowledgeTopic || '未标注';
    topicsBySubject[s][t] = (topicsBySubject[s][t] || 0) + 1;
  }
  const top = (obj, n) => Object.entries(obj).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, n);
  const subjectsArr = top(subjects, 8);
  return {
    range, total: list.length, annotated: annotated.length,
    subjects: subjectsArr,
    difficulties: Object.entries(difficulties).map(([name, count]) => ({ name, count })),
    topics: Object.entries(topicsBySubject).slice(0, 6).map(([subject, obj]) => ({ subject, items: top(obj, 8) })),
    coverage: { subjects: Object.keys(subjects).length, topics: new Set(annotated.map((r) => r.knowledgeTopic).filter(Boolean)).size },
    adjusted: annotated.filter((r) => r.annotationSource === '学生手动修正').length
  };
}

async function diagnostic(ctx) {
  const user = util.auth(ctx);
  const knowledgePoint = String((ctx.body || {}).knowledgePoint || '').trim();
  util.need(knowledgePoint, '请先指定知识点');
  const documentId = (ctx.body || {}).documentId || '';
  let context = '';
  if (documentId) {
    const ch = store.find('docChapters', (c) => c.documentId === documentId).slice(0, 2).map((c) => c.summary).join('\n');
    context = ch;
  }
  const exclude = store.find('diagnosticQuestions', (q) => q.userId === user.id && q.knowledgePoint === knowledgePoint).map((q) => q.questionText.slice(0, 40));
  const res = await ai.chatJSON(prompts.diagnosticMessages({ knowledgePoint, context, exclude }), {
    purpose: 'diagnostic-question', userId: user.id, maxTokens: 2048,
    validate: (o) => (o && o.questionText && o.answer ? [] : ['缺少 questionText 或 answer'])
  });
  if (!res.ok) return { ok: false, error: '题目没有生成成功，请稍后重试' };
  const saved = store.insert('diagnosticQuestions', {
    userId: user.id, documentId: documentId || null, knowledgePoint,
    questionType: String(res.data.questionType || '问答题').slice(0, 20),
    questionText: String(res.data.questionText).slice(0, 1200),
    answer: String(res.data.answer).slice(0, 1200), explanation: String(res.data.explanation || '').slice(0, 1200),
    source: 'AI 生成（按需）'
  });
  return { ok: true, question: { id: saved.id, knowledgePoint: saved.knowledgePoint, questionType: saved.questionType, questionText: saved.questionText } };
}

async function diagnosticCheck(ctx) {
  const user = util.auth(ctx);
  const q = store.one('diagnosticQuestions', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(q, '题目不存在', 404);
  return { answer: q.answer, explanation: q.explanation };
}

module.exports = {
  'POST /api/solve': solve,
  'POST /api/solve/image-extract': imageExtract,
  'GET /api/solve/history': history,
  'GET /api/solve/stats': stats,
  'GET /api/solve/:id': detail,
  'PATCH /api/solve/:id/annotation': patchAnnotation,
  'DELETE /api/solve/:id': removeRecord,
  'POST /api/solve/:id/followup': followup,
  'POST /api/diagnostic': diagnostic,
  'GET /api/diagnostic/:id': diagnosticCheck
};
