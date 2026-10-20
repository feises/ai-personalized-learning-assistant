'use strict';
// 后台任务：院校/专业核查、自述提炼、资料解析、链接核验、每日建议。全部异步，不阻塞前台。
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const ai = require('./lib/ai');
const prompts = require('./lib/prompts');
const util = require('./lib/api/util');
const scheduler = require('./lib/scheduler');

/* ------------------------- F-02 院校 / 专业核查 ------------------------- */
async function verifyEntity(profileId) {
  const rec = store.one('schoolMajorProfiles', (x) => x.id === profileId);
  if (!rec) return;
  store.update('schoolMajorProfiles', (x) => x.id === profileId, { status: 'verifying' });
  const res = await ai.chatJSON(prompts.verifyEntityMessages(rec.kind, rec.raw), {
    purpose: 'verify-entity', userId: rec.userId, maxTokens: 2048, model: ai.readConfig().model,
    validate: (o) => (o && typeof o.normalizedName === 'string' ? [] : ['缺少 normalizedName'])
  });
  if (!res.ok) {
    store.update('schoolMajorProfiles', (x) => x.id === profileId, {
      status: 'failed', note: '核查暂时没有完成，你的原始填写已保留，可以稍后重试。'
    });
    return;
  }
  const d = res.data;
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 12).map((it) => ({
    text: String(it.text || '').slice(0, 300),
    confidence: it.confidence === 'high' ? '已核实' : '待核实',
    source: '模型知识库（未联网核查）'
  })).filter((x) => x.text);
  store.update('schoolMajorProfiles', (x) => x.id === profileId, {
    status: d.uncertain ? 'uncertain' : 'verified',
    normalizedName: String(d.normalizedName || rec.raw).slice(0, 80),
    attributes: d.attributes || {}, items, version: (rec.version || 1) + 1,
    note: d.uncertain ? '部分信息未能确认，已标注为「待核实」。' : ''
  });
}

/* --------------------------- F-07 自述提炼 --------------------------- */
function upsertMaterial(userId, module, content, sourceRef) {
  const old = store.one('promptMaterials', (m) => m.userId === userId && m.module === module);
  const version = old ? (old.version || 1) + 1 : 1;
  if (old) {
    store.update('promptMaterials', (m) => m.id === old.id, { content, version, sourceRef, expired: false, updatedAt: store.now() });
  } else {
    store.insert('promptMaterials', { userId, module, content, version, sourceRef, expired: false });
  }
}

async function extractSelfReport(reportId) {
  const rep = store.one('selfReports', (x) => x.id === reportId);
  if (!rep) return;
  store.update('selfReports', (x) => x.id === reportId, { status: 'extracting' });
  if (!String(rep.rawText || '').trim()) {
    store.update('selfReports', (x) => x.id === reportId, { status: 'empty' });
    return;
  }
  const res = await ai.chatJSON(prompts.extractSelfReportMessages(rep.rawText), {
    purpose: 'extract-self-report', userId: rep.userId, maxTokens: 4096,
    validate: (o) => (o && Array.isArray(o.items) ? [] : ['缺少 items 数组'])
  });
  if (!res.ok) {
    store.update('selfReports', (x) => x.id === reportId, { status: 'failed' });
    return;
  }
  store.remove('selfReportItems', (i) => i.reportId === reportId);
  const items = (res.data.items || []).slice(0, 40).map((it) => ({
    reportId, userId: rep.userId,
    content: String(it.content || '').slice(0, 300),
    itemType: String(it.itemType || '自述').slice(0, 20),
    sourceType: it.sourceType === 'subjective' ? 'subjective' : 'objective',
    sourceSpan: String(it.sourceSpan || '').slice(0, 200),
    adopted: true
  })).filter((x) => x.content);
  for (const it of items) store.insert('selfReportItems', it);
  const objective = items.filter((i) => i.sourceType === 'objective').map((i) => i.content);
  const subjective = items.filter((i) => i.sourceType === 'subjective').map((i) => '学生自述（非能力判定）：' + i.content);
  upsertMaterial(rep.userId, 'self_report', { objective, subjective }, { kind: 'self_report', id: reportId });
  store.update('selfReports', (x) => x.id === reportId, { status: 'done', itemCount: items.length });
}

/* --------------------------- F-09 资料解析 --------------------------- */
function readDocText(doc, max) {
  try {
    const p = path.join(store.UPLOAD_DIR, doc.id + '.txt');
    if (!fs.existsSync(p)) return '';
    const t = fs.readFileSync(p, 'utf8');
    return max ? t.slice(0, max) : t;
  } catch (e) { return ''; }
}

function chunkText(text, size) {
  const paras = text.split(/\n{2,}/);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > size && cur) { chunks.push(cur); cur = p; }
    else cur = cur ? cur + '\n\n' + p : p;
    if (chunks.length >= 3) break;
  }
  if (cur && chunks.length < 4) chunks.push(cur);
  return chunks.length ? chunks : [text.slice(0, size)];
}

async function analyzeDocument(docId) {
  const doc = store.one('documents', (x) => x.id === docId);
  if (!doc) return;
  store.update('documents', (x) => x.id === docId, { parseStatus: 'parsing', progressNote: '正在分析内容' });
  const text = readDocText(doc, 60000);
  if (!text.trim()) {
    store.update('documents', (x) => x.id === docId, { parseStatus: 'failed', failReason: '没有可分析的文字内容' });
    return;
  }
  const chunks = chunkText(text, 12000);
  const merged = { overview: '', chapters: [], knowledgePoints: [], difficultyMarks: [], learningOrder: [], diagnosticQuestions: [] };
  for (let i = 0; i < chunks.length; i++) {
    const res = await ai.chatJSON(prompts.analyzeDocumentMessages({
      title: doc.title, text: chunks[i],
      partInfo: chunks.length > 1 ? '（这是资料的第 ' + (i + 1) + ' / ' + chunks.length + ' 部分，只输出本部分的内容）' : ''
    }), {
      purpose: 'analyze-document', userId: doc.userId, maxTokens: 8192, temperature: 0.2,
      validate: (o) => {
        const errs = [];
        if (!Array.isArray(o.chapters)) errs.push('chapters 必须是数组');
        if (!Array.isArray(o.knowledgePoints)) errs.push('knowledgePoints 必须是数组');
        return errs;
      }
    });
    if (!res.ok) {
      if (i === 0) {
        store.update('documents', (x) => x.id === docId, { parseStatus: 'failed', failReason: '分析没有完成，可以重新解析' });
        return;
      }
      break;
    }
    const d = res.data;
    if (d.overview && !merged.overview) merged.overview = String(d.overview);
    for (const key of ['chapters', 'knowledgePoints', 'difficultyMarks', 'learningOrder', 'diagnosticQuestions']) {
      if (Array.isArray(d[key])) merged[key] = merged[key].concat(d[key]);
    }
  }
  const uniq = (arr, keyFn) => { const seen = new Set(); return arr.filter((x) => { const k = keyFn(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
  const chapters = uniq(merged.chapters, (c) => String(c.title || '').trim()).slice(0, 60).map((c, i) => ({
    title: String(c.title || '第 ' + (i + 1) + ' 节').slice(0, 120),
    summary: String(c.summary || '').slice(0, 500),
    concepts: (c.concepts || []).slice(0, 12).map((x) => String(x).slice(0, 60)),
    terms: (c.terms || []).slice(0, 12).map((x) => String(x).slice(0, 60)),
    orderNo: i + 1
  }));
  const kps = uniq(merged.knowledgePoints, (k) => String(k.name || '').trim()).slice(0, 120).map((k) => ({
    name: String(k.name || '').slice(0, 80), chapter: String(k.chapter || '').slice(0, 120),
    difficulty: ['基础', '中等', '较难', '困难'].includes(k.difficulty) ? k.difficulty : '中等',
    prerequisites: (k.prerequisites || []).slice(0, 8).map((x) => String(x).slice(0, 60))
  }));
  const marks = uniq(merged.difficultyMarks, (m) => String(m.chapter || '') + String(m.reason || '').slice(0, 20)).slice(0, 40).map((m) => ({
    chapter: String(m.chapter || '').slice(0, 120),
    level: ['一般', '较难', '重点难点'].includes(m.level) ? m.level : '较难',
    reason: String(m.reason || '').slice(0, 400),
    missingPrerequisites: (m.missingPrerequisites || []).slice(0, 8).map((x) => String(x).slice(0, 60)),
    source: 'AI 判定', feedback: ''
  }));
  const questions = uniq(merged.diagnosticQuestions, (q) => String(q.questionText || '').trim()).slice(0, 12).map((q) => ({
    knowledgePoint: String(q.knowledgePoint || '').slice(0, 80),
    questionType: String(q.questionType || '问答题').slice(0, 20),
    questionText: String(q.questionText || '').slice(0, 1000),
    answer: String(q.answer || '').slice(0, 1000),
    explanation: String(q.explanation || '').slice(0, 1000),
    source: 'AI 生成'
  }));

  store.remove('docChapters', (c) => c.documentId === docId);
  store.remove('docKnowledgePoints', (k) => k.documentId === docId);
  store.remove('difficultyMarks', (m) => m.documentId === docId);
  store.remove('diagnosticQuestions', (q) => q.documentId === docId);
  for (const c of chapters) store.insert('docChapters', Object.assign({ documentId: docId, userId: doc.userId }, c));
  for (const k of kps) {
    const topic = util.getOrCreateTopic(doc.userId, k.name);
    store.insert('docKnowledgePoints', Object.assign({ documentId: docId, userId: doc.userId, topicId: topic.id }, k));
  }
  for (const m of marks) store.insert('difficultyMarks', Object.assign({ documentId: docId, userId: doc.userId }, m));
  for (const q of questions) store.insert('diagnosticQuestions', Object.assign({ documentId: docId, userId: doc.userId }, q));

  store.update('documents', (x) => x.id === docId, {
    parseStatus: 'done', overview: merged.overview, learningOrder: (merged.learningOrder || []).slice(0, 30).map((x) => String(x).slice(0, 80)),
    chapterCount: chapters.length, knowledgeCount: kps.length, difficultyCount: marks.length,
    version: (doc.version || 1) + 1, progressNote: '', analyzedAt: store.now(),
    truncated: text.length >= 60000
  });
  upsertMaterial(doc.userId, 'document_' + docId, {
    overview: merged.overview, chapters: chapters.slice(0, 20).map((c) => c.title), knowledge: kps.slice(0, 40).map((k) => k.name)
  }, { kind: 'document', id: docId });
}

/* --------------------------- F-05 推荐与链接 --------------------------- */
/** 学生明确表示「不感兴趣 / 不想学」的方向：资源推荐与每日建议都要避开（FR-05-25 / FR-10-18）。 */
function avoidedTopics(userId) {
  const now = new Date();
  const alive = (p) => !p.until || new Date(p.until) > now;
  const list = []
    .concat(store.find('resourcePreferences', (p) => p.userId === userId && alive(p)).map((p) => p.topic))
    .concat(store.find('topicPreferences', (p) => p.userId === userId && alive(p)).map((p) => p.topic))
    .map((t) => util.normalizeName(t))
    .filter(Boolean);
  return Array.from(new Set(list));
}

async function refreshRecommendations(userId, exclude) {
  const profile = util.aiContext(userId);
  const avoided = avoidedTopics(userId);
  const topics = util.topicNames(userId, 6).map((t) => t.name)
    .filter((n) => !avoided.includes(util.normalizeName(n)));
  const bookmarked = store.find('resourceBookmarks', (b) => b.userId === userId)
    .map((b) => store.one('resources', (r) => r.id === b.resourceId)).filter(Boolean).map((r) => r.title);
  const res = await ai.chatJSON(prompts.resourceRecommendMessages({ profile, topics, bookmarked, exclude, avoided }), {
    purpose: 'resource-recommend', userId, maxTokens: 4096,
    validate: (o) => (o && Array.isArray(o.cards) ? [] : ['缺少 cards 数组'])
  });
  if (!res.ok) return { ok: false, error: res.error };
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((c) => { const k = c.title + '|' + c.platform; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  let cards = dedupe((res.data.cards || []).map(util.normalizeCard)).slice(0, 5);
  if (avoided.length) {
    // 硬过滤：命中「不感兴趣」方向的直接丢弃；若全被过滤则保留原结果，避免推荐区变空
    const keep = cards.filter((c) => !avoided.some((a) => c.topic.includes(a) || a.includes(c.topic)));
    if (keep.length) cards = keep;
  }
  const saved = cards.map((c) => {
    const key = c.title + '|' + c.platform;
    let item = store.one('resources', (r) => r.userId === userId && r.key === key);
    if (item) { store.update('resources', (r) => r.id === item.id, { lastRecommendedAt: store.now() }); return item; }
    return store.insert('resources', Object.assign({ userId, key, recommendedAt: store.now(), lastRecommendedAt: store.now(), openCount: 0 }, c));
  });
  store.insert('recommendationBatches', { userId, resourceIds: saved.map((r) => r.id), at: store.now() });
  return { ok: true, resources: saved, avoided };
}

async function verifyResource(resourceId) {
  const r = store.one('resources', (x) => x.id === resourceId);
  if (!r) return;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(r.url, { method: 'GET', signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 LearningAssistant' } });
    clearTimeout(timer);
    const status = res.status === 404 || res.status === 410 ? '已失效' : (res.status < 400 ? '可用' : '待核验');
    store.update('resources', (x) => x.id === resourceId, { linkStatus: status, lastVerifiedAt: store.now() });
  } catch (e) {
    clearTimeout(timer);
    store.update('resources', (x) => x.id === resourceId, { lastVerifiedAt: store.now() });
  }
}

async function verifyAllLinks() {
  const list = store.find('resources', (r) => r.linkStatus !== '已失效').slice(0, 40);
  for (const r of list) await verifyResource(r.id);
}

/* ----------------------------- F-10 每日建议 ----------------------------- */
async function generateSuggestion(userId, date) {
  const day = date || util.today();
  const exists = store.one('suggestions', (s) => s.userId === userId && s.date === day);
  if (exists) return exists;
  const profile = util.aiContext(userId);
  const time = store.one('timeConstraints', (t) => t.userId === userId);
  const restDays = time ? time.restDays : [];
  const restToday = util.isRestDay(day, restDays);
  const avoided = avoidedTopics(userId);
  const pendingAll = store.find('studyTasks', (t) => t.userId === userId && t.plannedDate === day && t.status !== '已完成' && t.status !== '跳过');
  // 学生说过「不想学这个」的方向优先避开；但若因此没有可选任务，仍回退到全部，保证每天都有建议
  const preferred = avoided.length
    ? pendingAll.filter((t) => !(t.knowledgePoints || []).some((k) => avoided.includes(util.normalizeName(k))))
    : pendingAll;
  const tasks = preferred.length ? preferred : pendingAll;
  const planUnit = tasks.length ? { title: tasks[0].title, completionCriteria: tasks[0].completionCriteria } : null;
  const recent = store.find('learningRecords', (r) => r.userId === userId).slice(-6);
  const evidence = recent.length
    ? recent.map((r) => r.topicName + '：' + r.result).join('；')
    : util.topicNames(userId, 3).map((t) => t.name).join('、');
  const rest = store.one('suggestionFeedbacks', (f) => f.userId === userId && f.date === day && f.type === 'rest');
  if (rest) return null;

  if (restToday) {
    return store.insert('suggestions', {
      userId, date: day, content: '今天是计划里的休息日，好好休息。', type: '休息',
      reason: '你设定的每周休息日是' + (restDays.join('、') || '—') + '（1 表示周一）', estimatedMinutes: 0,
      related: planUnit ? { taskTitle: planUnit.title } : null, status: '待响应'
    });
  }
  const res = await ai.chatJSON(prompts.dailySuggestionMessages({ profile, planUnit, evidence, restToday, avoided }), {
    purpose: 'daily-suggestion', userId, maxTokens: 2048,
    validate: (o) => (o && typeof o.content === 'string' && o.content ? [] : ['缺少 content'])
  });
  if (res.ok) {
    const d = res.data;
    return store.insert('suggestions', {
      userId, date: day, content: String(d.content).slice(0, 200), type: String(d.type || '学习').slice(0, 20),
      reason: String(d.reason || '').slice(0, 200), estimatedMinutes: Number(d.minutes) || 30,
      related: planUnit ? { taskTitle: planUnit.title } : null, status: '待响应'
    });
  }
  if (planUnit) {
    return store.insert('suggestions', {
      userId, date: day, content: '今天可以接着做：' + planUnit.title, type: '继续计划',
      reason: '这是你计划里今天的内容', estimatedMinutes: tasks[0].estimatedMinutes || 30,
      related: { taskTitle: planUnit.title }, status: '待响应'
    });
  }
  return null;
}

/* ------------------------------- 启动与轮询 ------------------------------- */
function resumePending() {
  for (const d of store.find('documents', (x) => x.parseStatus === 'pending' || x.parseStatus === 'parsing')) util.async(() => analyzeDocument(d.id));
  for (const s of store.find('schoolMajorProfiles', (x) => x.status === 'pending' || x.status === 'verifying')) util.async(() => verifyEntity(s.id));
  for (const r of store.find('selfReports', (x) => x.status === 'pending' || x.status === 'extracting')) util.async(() => extractSelfReport(r.id));
}

function startWorkers() {
  setTimeout(() => { try { resumePending(); } catch (e) { console.error('[workers]', e.message); } }, 1500);
  setTimeout(() => { verifyAllLinks().catch(() => {}); }, 25000);
  setInterval(() => { verifyAllLinks().catch(() => {}); }, 6 * 3600 * 1000);
}

module.exports = {
  verifyEntity, extractSelfReport, analyzeDocument, readDocText,
  refreshRecommendations, verifyResource, verifyAllLinks, generateSuggestion, upsertMaterial, startWorkers, avoidedTopics
};
