'use strict';
// M-01「我的」页面数据、数据说明、分类清除与导出
const store = require('../store');
const util = require('./util');

const CATEGORIES = [
  { key: 'profile', name: '基本信息与学习目标', what: '院校、专业、学期、学院系别、性别（可跳过）、学习目标、每周可学时间与休息日', purpose: '为你安排学习计划与讲解语境', deletable: false },
  { key: 'selfreport', name: '我的学习情况（自述）', what: '你写的学习情况原文，以及从中提炼出的条目', purpose: '让讲解与推荐更贴合你，主观自述只作背景', deletable: true },
  { key: 'entity', name: '院校与专业背景资料', what: '你自填的院校 / 专业名称与核对结果', purpose: '统一口径，避免术语不一致', deletable: true },
  { key: 'solve', name: '搜题记录', what: '题目、图片、解答、学科与知识点标注、追问记录', purpose: '为你生成搜题统计与学习建议', deletable: true },
  { key: 'resources', name: '资源行为与资源库', what: '检索关键词、收藏、打开记录', purpose: '为你本人推荐资源', deletable: true },
  { key: 'documents', name: '上传资料与学习计划', what: '你上传的文件、解析结果、难点、诊断题、计划与任务', purpose: '生成学习计划并跟踪执行', deletable: true },
  { key: 'growth', name: '任务与练习记录', what: '任务完成情况、练习结果、错因、理解反馈、知识点状态', purpose: '调整后续安排', deletable: true },
  { key: 'suggestions', name: '每日建议与反馈', what: '每天的建议与你的三个按钮反馈', purpose: '生成下一天的建议', deletable: true }
];

function countOf(userId, key) {
  const f = (c, fn) => store.find(c, fn).length;
  switch (key) {
    case 'profile': return (store.one('profiles', (p) => p.userId === userId) ? 1 : 0) + f('goals', (g) => g.userId === userId) + (store.one('timeConstraints', (t) => t.userId === userId) ? 1 : 0);
    case 'selfreport': return f('selfReports', (r) => r.userId === userId) + f('selfReportItems', (i) => i.userId === userId);
    case 'entity': return f('schoolMajorProfiles', (p) => p.userId === userId);
    case 'solve': return f('questionRecords', (q) => q.userId === userId) + f('answerRequestLogs', (l) => l.userId === userId);
    case 'resources': return f('resources', (r) => r.userId === userId) + f('resourceBookmarks', (b) => b.userId === userId) + f('resourceBehaviors', (b) => b.userId === userId);
    case 'documents': return f('documents', (d) => d.userId === userId) + f('studyPlans', (p) => p.userId === userId) + f('studyTasks', (t) => t.userId === userId);
    case 'growth': return f('learningRecords', (r) => r.userId === userId) + f('knowledgeStates', (s) => s.userId === userId);
    case 'suggestions': return f('suggestions', (s) => s.userId === userId);
    default: return 0;
  }
}

async function overview(ctx) {
  const user = util.auth(ctx);
  const profile = util.profileOf(user.id);
  const selfItems = store.find('selfReportItems', (i) => i.userId === user.id);
  const rep = store.one('selfReports', (r) => r.userId === user.id);
  const docs = store.find('documents', (d) => d.userId === user.id);
  const plans = store.find('studyPlans', (p) => p.userId === user.id);
  const states = store.find('knowledgeStates', (s) => s.userId === user.id);
  const records = store.find('learningRecords', (r) => r.userId === user.id);
  const bookmarks = store.find('resourceBookmarks', (b) => b.userId === user.id);
  const suggestions = store.find('suggestions', (s) => s.userId === user.id);
  const entity = store.find('schoolMajorProfiles', (p) => p.userId === user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const todayTasks = store.find('studyTasks', (t) => t.userId === user.id && t.plannedDate === util.today());

  const stateText = { pending: '待核对', verifying: '核对中', verified: '已核实', uncertain: '待核实', failed: '核对失败' };
  return {
    identity: { nickname: user.nickname, school: profile.school, majorName: profile.majorName, grade: profile.grade, educationLevel: profile.educationLevel },
    entries: [
      { key: 'basic', zone: 'B', name: '基本信息', summary: [profile.educationLevel, profile.term, profile.department].filter(Boolean).join(' · ') || '未填写', state: profile.complete ? '已填写' : '未填写', action: '编辑' },
      { key: 'goal', zone: 'B', name: '学习目标与时间约束', summary: (profile.goals.filter((g) => g.status === '进行中').length) + ' 个目标 · ' + (profile.time ? '每天 ' + profile.time.minutesPerDay + ' 分钟' : '未设置时间'), state: profile.time ? '已填写' : '未填写', action: '编辑' },
      { key: 'entity', zone: 'B', name: '院校与专业资料', summary: entity ? (entity.normalizedName || entity.raw) + ' · ' + (stateText[entity.status] || entity.status) : '还没有自填内容', state: entity ? (stateText[entity.status] || entity.status) : '未填写', action: '查看' },
      { key: 'selfreport', zone: 'B', name: '我的学习情况', summary: selfItems.length ? selfItems.length + ' 条提炼内容' : (rep ? '已跳过' : '未填写'), state: selfItems.length ? '已填写' : '未填写', action: '查看' },
      { key: 'documents', zone: 'C', name: '学习资料与计划', summary: docs.length + ' 份资料 · ' + plans.filter((p) => p.status === '进行中').length + ' 个进行中计划', state: docs.length ? '有内容' : '未填写', action: '查看' },
      { key: 'growth', zone: 'C', name: '成长记录', summary: states.length + ' 个知识点 · ' + records.length + ' 条记录', state: records.length ? '有记录' : '未填写', action: '查看' },
      { key: 'library', zone: 'C', name: '我的资源库', summary: bookmarks.length + ' 条收藏', state: bookmarks.length ? '有内容' : '未填写', action: '查看' },
      { key: 'suggestions', zone: 'C', name: '每日建议记录', summary: suggestions.length + ' 条历史建议', state: suggestions.length ? '有记录' : '未填写', action: '查看' },
      { key: 'privacy', zone: 'D', name: '数据与隐私', summary: '平台记录了什么、怎么清除', state: '可查看', action: '查看' }
    ],
    today: { date: util.today(), taskCount: todayTasks.length, done: todayTasks.filter((t) => t.status === '已完成').length }
  };
}

async function dataMap(ctx) {
  const user = util.auth(ctx);
  return {
    categories: CATEGORIES.map((c) => Object.assign({}, c, { count: countOf(user.id, c.key) })),
    notice: '这里的数据只用于给你本人提供学习安排与讲解，不会生成面向老师、家长或第三方的评价。清除后相关功能会少一些参考，但都能继续使用。'
  };
}

function purgeScope(userId, key) {
  switch (key) {
    case 'selfreport':
      store.remove('selfReportItems', (i) => i.userId === userId);
      store.remove('selfReports', (r) => r.userId === userId);
      store.remove('promptMaterials', (m) => m.userId === userId && m.module === 'self_report');
      break;
    case 'entity':
      store.remove('schoolMajorProfiles', (p) => p.userId === userId);
      store.remove('schoolMajorFeedbacks', (f) => f.userId === userId);
      break;
    case 'solve':
      store.remove('questionMessages', (m) => m.userId === userId);
      store.remove('questionRecords', (q) => q.userId === userId);
      store.remove('tutorSessions', (s) => s.userId === userId);
      store.remove('answerRequestLogs', (l) => l.userId === userId);
      break;
    case 'resources':
      store.remove('resources', (r) => r.userId === userId);
      store.remove('resourceBookmarks', (b) => b.userId === userId);
      store.remove('resourceBehaviors', (b) => b.userId === userId);
      store.remove('resourceDialogs', (d) => d.userId === userId);
      store.remove('resourcePreferences', (p) => p.userId === userId);
      store.remove('recommendationBatches', (b) => b.userId === userId);
      break;
    case 'documents':
      store.remove('studyTasks', (t) => t.userId === userId);
      store.remove('taskAdjustments', (a) => a.userId === userId);
      store.remove('studyPlans', (p) => p.userId === userId);
      store.remove('docChapters', (c) => c.userId === userId);
      store.remove('docKnowledgePoints', (k) => k.userId === userId);
      store.remove('difficultyMarks', (m) => m.userId === userId);
      store.remove('diagnosticQuestions', (q) => q.userId === userId && q.documentId);
      store.remove('promptMaterials', (m) => m.userId === userId && String(m.module).startsWith('document_'));
      store.remove('documents', (d) => d.userId === userId);
      break;
    case 'growth':
      store.remove('learningRecords', (r) => r.userId === userId);
      store.remove('knowledgeStates', (s) => s.userId === userId);
      break;
    case 'suggestions':
      store.remove('suggestions', (s) => s.userId === userId);
      store.remove('suggestionFeedbacks', (f) => f.userId === userId);
      store.remove('topicPreferences', (p) => p.userId === userId);
      break;
    default: break;
  }
}

async function purge(ctx) {
  const user = util.auth(ctx);
  const scope = String((ctx.body || {}).scope || '');
  util.need(scope, '请选择要清除的内容');
  const keys = scope === 'all' ? CATEGORIES.filter((c) => c.deletable).map((c) => c.key) : [scope];
  for (const k of keys) purgeScope(user.id, k);
  return { ok: true, cleared: keys };
}

async function exportAll(ctx) {
  const user = util.auth(ctx);
  const uid = user.id;
  const dump = {
    exportedAt: store.now(),
    user: { username: user.username, nickname: user.nickname },
    profile: util.profileOf(uid),
    selfReport: store.one('selfReports', (r) => r.userId === uid) || null,
    selfReportItems: store.find('selfReportItems', (i) => i.userId === uid),
    schoolMajorProfiles: store.find('schoolMajorProfiles', (p) => p.userId === uid),
    questionRecords: store.find('questionRecords', (q) => q.userId === uid),
    resources: store.find('resources', (r) => r.userId === uid),
    bookmarks: store.find('resourceBookmarks', (b) => b.userId === uid),
    documents: store.find('documents', (d) => d.userId === uid).map((d) => ({ id: d.id, title: d.title, parseStatus: d.parseStatus, createdAt: d.createdAt })),
    plans: store.find('studyPlans', (p) => p.userId === uid),
    tasks: store.find('studyTasks', (t) => t.userId === uid),
    learningRecords: store.find('learningRecords', (r) => r.userId === uid),
    knowledgeStates: store.find('knowledgeStates', (s) => s.userId === uid),
    suggestions: store.find('suggestions', (s) => s.userId === uid)
  };
  return { __file: true, data: Buffer.from(JSON.stringify(dump, null, 2), 'utf8'), type: 'application/json', filename: 'my-data.json' };
}

module.exports = {
  'GET /api/me/overview': overview,
  'GET /api/privacy/data-map': dataMap,
  'POST /api/privacy/purge': purge,
  'GET /api/privacy/export': exportAll
};
