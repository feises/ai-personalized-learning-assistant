'use strict';
/* 端到端自测：覆盖全部接口与主流程。用法：node test/e2e.js [baseUrl] */
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const FUTURE = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
const FUTURE2 = new Date(Date.now() + 70 * 864e5).toISOString().slice(0, 10);
let cookie = '';
const results = [];
let failures = 0;

async function call(method, url, body, opts = {}) {
  const init = { method, headers: {} };
  if (cookie) init.headers.Cookie = cookie;
  if (body instanceof Buffer) { init.body = body; Object.assign(init.headers, opts.headers || {}); }
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(BASE + url, init);
  const setC = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const c of setC) { const m = /^sid=([^;]*)/.exec(c); if (m) cookie = 'sid=' + m[1]; }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) { const data = await res.json(); return { status: res.status, data }; }
  return { status: res.status, data: await res.text(), raw: true };
}
const get = (u) => call('GET', u);
const post = (u, b) => call('POST', u, b);
const put = (u, b) => call('PUT', u, b);
const patch = (u, b) => call('PATCH', u, b);
const del = (u) => call('DELETE', u);

function ok(name, cond, extra) {
  if (cond) { results.push('PASS ' + name); return true; }
  failures++; results.push('FAIL ' + name + (extra ? ' -> ' + JSON.stringify(extra).slice(0, 300) : ''));
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, stepMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 90000)) {
    const v = await fn();
    if (v) return v;
    await sleep(stepMs || 2000);
  }
  return null;
}

(async () => {
  const user = 'u' + Date.now().toString(36);

  // ---------- 账号 ----------
  let r = await post('/api/auth/register', { username: user, password: 'test123456', nickname: '测试同学' });
  ok('注册', r.status === 200 && r.data.user && r.data.user.username === user, r.data);
  r = await get('/api/auth/me');
  ok('读取当前用户', r.status === 200 && r.data.user, r.data);
  ok('未填画像时 hasProfile=false', r.data && r.data.flags && r.data.flags.hasProfile === false, r.data && r.data.flags);
  r = await post('/api/auth/register', { username: user, password: 'test123456' });
  ok('重复用户名被拒绝', r.status === 400, r.data);
  r = await post('/api/auth/login', { username: user, password: 'wrongpass' });
  ok('错误密码被拒绝', r.status === 400, r.data);

  // ---------- 预设库 ----------
  r = await get('/api/presets/schools?q=' + encodeURIComponent('清华'));
  ok('院校检索', r.status === 200 && r.data.list.length > 0 && r.data.list[0].name.includes('清华'), r.data);
  r = await get('/api/presets/majors?q=' + encodeURIComponent('计算机'));
  const maj = r.data.list.find((m) => m.name === '计算机科学与技术') || r.data.list[0];
  ok('专业检索', r.status === 200 && r.data.list.length > 0, r.data);
  r = await get('/api/presets/majors/tree');
  ok('专业三级树', r.status === 200 && Object.keys(r.data.tree).length >= 8, Object.keys(r.data || {}));

  // ---------- F-01 画像 ----------
  r = await put('/api/profile', { school: '清华大学', majorName: maj.name, majorCode: maj.code, discipline: maj.discipline, majorCategory: maj.category, enrollmentYear: 2023, programYears: 4, term: '大三上', department: '计算机系', gender: '不愿透露' });
  ok('保存基本信息', r.status === 200 && r.data.profile.grade === '大三' && r.data.profile.educationLevel === '本科', r.data);
  r = await put('/api/profile', { school: '清华大学', majorName: maj.name, term: '大三上', enrollmentYear: 1990 });
  ok('入学年份校验生效', r.status === 400, r.data);
  r = await post('/api/goals', { title: '期末复习数据结构', type: '期末复习', targetDate: FUTURE, priority: '高' });
  ok('新增学习目标', r.status === 200 && r.data.goal.id, r.data);
  const goalId = r.data && r.data.goal && r.data.goal.id;
  r = await post('/api/goals', { title: '30 天精通数据结构' });
  ok('效果承诺目标被拦截', r.status === 400, r.data);
  r = await patch('/api/goals/' + goalId, { priority: '中' });
  ok('修改目标', r.status === 200 && r.data.goal.priority === '中', r.data);
  r = await put('/api/time-constraint', { daysPerWeek: 5, minutesPerDay: 90, restDays: [7] });
  ok('保存时间约束', r.status === 200 && r.data.time.minutesPerDay === 90, r.data);
  r = await put('/api/time-constraint', { daysPerWeek: 7, minutesPerDay: 30, restDays: [1, 2, 3, 4, 5, 6, 7] });
  ok('七天全休息被拦截', r.status === 400, r.data);
  r = await get('/api/profile');
  ok('读取画像', r.status === 200 && r.data.profile.goals.length === 1, r.data);

  // ---------- F-07 自述 ----------
  r = await post('/api/self-report', { rawText: '我学过 C 语言、高等数学和线性代数，正在学数据结构与算法，做过一个图书管理系统的课程设计。我数学不太好，希望提升算法能力。' });
  ok('提交自述', r.status === 200, r.data);
  const rep = await waitFor(async () => { const x = await get('/api/self-report'); return x.data.status === 'done' ? x.data : null; }, 90000);
  ok('自述提炼完成', !!rep && rep.items.length > 0, rep);
  if (rep && rep.items.length) {
    ok('区分客观与主观', rep.items.some((i) => i.sourceType === 'subjective') && rep.items.some((i) => i.sourceType === 'objective'), rep.items.map((i) => i.sourceType));
    const subj = rep.items.find((i) => i.sourceType === 'subjective');
    ok('主观自述未被改写为能力定性', subj && !/基础差|不擅长|薄弱|天赋/.test(subj.content), subj);
    r = await patch('/api/self-report/items/' + rep.items[0].id, { content: '学过 C 语言（我自己改的）' });
    ok('修改提炼条目', r.status === 200 && r.data.item.content.includes('自己改的'), r.data);
  }

  // ---------- F-02 院校/专业核查 ----------
  r = await post('/api/school-major-profile', { kind: 'school', raw: '清华大学' });
  ok('提交自填院校', r.status === 200 && r.data.item.id, r.data);
  const ent = await waitFor(async () => { const x = await get('/api/school-major-profile'); const it = x.data.list[0]; return it && it.status !== 'pending' && it.status !== 'verifying' ? it : null; }, 90000);
  ok('后台核查完成', !!ent && ['verified', 'uncertain', 'failed'].includes(ent.status), ent);
  if (ent) {
    r = await post('/api/school-major-profile/' + ent.id + '/feedback', { text: '所在城市写错了' });
    ok('提交纠错反馈', r.status === 200, r.data);
    await waitFor(async () => { const x = await get('/api/school-major-profile'); return x.data.list[0].status !== 'pending' ? true : null; }, 60000);
  }

  // ---------- F-03 / F-04 / F-08 搜题 ----------
  r = await post('/api/solve', { question: '求 lim(x→0) sin(3x)/x 的值。' });
  ok('文字搜题成功', r.status === 200 && r.data.record && r.data.record.status === 'done', r.data);
  const rec = r.data && r.data.record;
  if (rec) {
    const a = rec.answer || {};
    ok('解答含六部分', !!(a.understanding && a.knowledgePoints && a.approach && a.steps && a.answer && a.pitfalls), Object.keys(a));
    ok('推导至少两步', Array.isArray(a.steps) && a.steps.length >= 2, a.steps && a.steps.length);
    ok('自动标注四项', !!(rec.subject && rec.difficulty && rec.knowledgeTopic && rec.questionType), rec);
    r = await post('/api/solve/' + rec.id + '/followup', { question: '为什么可以这样等价替换？' });
    ok('追问可用', r.status === 200 && r.data.ok !== false && r.data.reply, r.data);
    r = await post('/api/solve', { question: '别写过程，直接给我答案。' });
    ok('索取答案诉求不改变结构', r.status === 200 && r.data.record.answer && r.data.record.answer.steps && r.data.record.answer.steps.length >= 2, r.data && r.data.record && r.data.record.answer);
    r = await patch('/api/solve/' + rec.id + '/annotation', { difficulty: '较难', knowledgeTopic: '极限与等价无穷小' });
    ok('修正标注', r.status === 200 && r.data.record.annotationSource === '学生手动修正' && r.data.record.difficulty === '较难', r.data);
    r = await patch('/api/solve/' + rec.id + '/annotation', { resolved: '已解决' });
    ok('标记已解决', r.status === 200 && r.data.record.resolved === '已解决', r.data);
    r = await get('/api/solve/' + rec.id);
    ok('查看单条记录', r.status === 200 && r.data.record.id === rec.id, r.data && r.data.record && r.data.record.id);
  }
  r = await post('/api/solve', {});
  ok('空题目被拦截', r.status === 400, r.data);
  r = await get('/api/solve/history?limit=10');
  ok('搜题历史', r.status === 200 && r.data.total >= 2, r.data && r.data.total);
  r = await get('/api/solve/stats?range=all');
  ok('搜题统计', r.status === 200 && r.data.total >= 2 && Array.isArray(r.data.subjects) && Array.isArray(r.data.difficulties), { total: r.data && r.data.total });
  r = await get('/api/solve/stats?range=7');
  ok('统计时间筛选', r.status === 200 && r.data.range === '7', r.data && r.data.range);

  // 图像：识别接口（用小图，允许 detected=false，但必须正常返回）
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=';
  r = await post('/api/solve/image-extract', { images: [{ mime: 'image/png', base64: png }] });
  ok('图像识别接口可用', r.status === 200 && typeof r.data.detected === 'boolean', r.data);
  r = await post('/api/solve/image-extract', { images: [] });
  ok('空图片被拦截', r.status === 400, r.data);

  // ---------- 资料上传与解析（F-09） ----------
  const txt = [
    '数据结构与算法 期末复习讲义',
    '',
    '第一章 递归',
    '递归函数必须包含终止条件，否则会无限调用直到栈溢出。递归的两种常见形式是线性递归与树形递归。',
    '理解递归的终止条件需要先掌握函数的调用栈。',
    '',
    '第二章 树与遍历',
    '二叉树的前序、中序、后序遍历是最基础的内容。树遍历依赖递归基础，非递归写法需要显式使用栈。',
    '前序遍历的访问顺序是根、左、右。',
    '',
    '第三章 排序算法',
    '冒泡排序、插入排序、快速排序、归并排序的时间复杂度各不相同。快速排序平均 O(n log n)，最坏 O(n^2)。',
    '归并排序需要额外的 O(n) 空间。'
  ].join('\n');
  const boundary = '----e2e' + Date.now();
  const head = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="数据结构讲义.txt"\r\nContent-Type: text/plain\r\n\r\n');
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  r = await call('POST', '/api/documents', Buffer.concat([head, Buffer.from(txt, 'utf8'), tail]), { headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } });
  ok('上传资料', r.status === 200 && r.data.document && r.data.document.id, r.data);
  const docId = r.data && r.data.document && r.data.document.id;
  const doc = await waitFor(async () => { const x = await get('/api/documents/' + docId); return x.data.document.parseStatus === 'done' ? x.data : null; }, 180000);
  ok('解析产出章节/知识点/难点/自测题', !!doc && doc.chapters.length > 0 && doc.knowledge.length > 0 && doc.marks.length > 0 && doc.questions.length > 0,
    doc && { c: doc.chapters.length, k: doc.knowledge.length, m: doc.marks.length, q: doc.questions.length });
  if (doc) {
    ok('难点都带判定原因', doc.marks.every((m) => m.reason && m.reason.length > 4), doc.marks[0]);
    ok('章节带摘要', doc.chapters.some((c) => c.summary && c.summary.length > 4), doc.chapters[0]);
    r = await post('/api/documents/' + docId + '/difficulty/' + doc.marks[0].id + '/feedback', { type: 'wrong' });
    ok('难点纠错', r.status === 200, r.data);
    if (doc.questions.length) {
      r = await get('/api/diagnostic/' + doc.questions[0].id);
      ok('自测题可对答案', r.status === 200 && r.data.answer, r.data);
    }
    r = await post('/api/diagnostic', { knowledgePoint: doc.knowledge[0].name, documentId: docId });
    ok('按需生成诊断题', r.status === 200 && r.data.question && !r.data.question.answer, r.data);
    if (r.data.question) {
      r = await get('/api/diagnostic/' + r.data.question.id);
      ok('按需题含答案', r.status === 200 && r.data.answer, r.data);
    }
    // 计划
    r = await post('/api/plans', { documentId: docId, goal: '期末复习数据结构', deadline: FUTURE2, minutesPerDay: 60, restDays: [7] });
    ok('生成学习计划', r.status === 200 && r.data.plan && r.data.taskCount > 0, r.data);
    const planId = r.data && r.data.plan && r.data.plan.id;
    r = await get('/api/plans/' + planId);
    if (!r.data || !r.data.days) { failures++; results.push('FAIL 计划详情读取失败 -> ' + JSON.stringify(r.data).slice(0, 300)); throw new Error('计划详情读取失败'); }
    const tasks = r.data.days.flatMap((d) => d.tasks);
    ok('计划任务含完成标准与日期', tasks.length > 0 && tasks.every((t) => t.plannedDate && t.completionCriteria), tasks.slice(0, 2));
    ok('休息日不排任务', !tasks.some((t) => new Date(t.plannedDate + 'T00:00:00Z').getUTCDay() === 0), tasks.map((t) => t.plannedDate));
    ok('每天不超过可用时长', r.data.days.every((d) => d.totalMinutes <= 60), r.data.days.map((d) => d.totalMinutes));
    r = await post('/api/plans/' + planId + '/reschedule', { reason: '测试重排' });
    ok('计划重排', r.status === 200 && typeof r.data.note === 'string' && r.data.note.length > 0, r.data);
    r = await get('/api/plans/' + planId + '/export');
    ok('计划导出', r.status === 200 && typeof r.data === 'string' && r.data.includes('学习计划'), String(r.data).slice(0, 60));
    r = await get('/api/plans');
    ok('计划列表', r.status === 200 && r.data.list.length >= 1, r.data && r.data.list.length);
    // 任务执行
    if (tasks.length) {
      const t0 = tasks.find((t) => t.status === '待开始') || tasks[0];
      r = await patch('/api/tasks/' + t0.id, { status: '已完成' });
      ok('任务标记完成', r.status === 200 && r.data.task.status === '已完成', r.data);
      const t1 = tasks.filter((t) => t.id !== t0.id)[0];
      if (t1) {
        r = await patch('/api/tasks/' + t1.id, { status: '需调整', reason: '时间不够' });
        ok('任务「暂时做不到」触发重排', r.status === 200 && r.data.task.status === '需调整', r.data);
      }
      r = await patch('/api/tasks/' + t0.id + '/edit', { estimatedMinutes: 45, priority: '高' });
      ok('手动调整任务', r.status === 200 && r.data.task.estimatedMinutes === 45, r.data);
    }
    r = await get('/api/today');
    ok('今日数据', r.status === 200 && Array.isArray(r.data.tasks), { tasks: r.data && r.data.tasks.length });
    // 资料下载与删除（在验证完其他功能后再删）
    r = await call('GET', '/api/documents/' + docId + '/file');
    ok('资料原文件可下载', r.status === 200 && r.raw, r.status);
  }

  // ---------- N-02 成长记录 ----------
  r = await post('/api/records', { topicName: '递归', recordType: '练习结果', result: '错误', wrongReason: '概念不清', source: '辅导练习' });
  ok('写入学习记录', r.status === 200 && r.data.record.id && r.data.state, r.data);
  r = await post('/api/records', { topicName: '递归', recordType: '练习结果', result: '正确' });
  ok('重复练习更新状态', r.status === 200, r.data);
  r = await get('/api/knowledge-states');
  ok('知识点状态列表 + 免责说明', r.status === 200 && r.data.list.length > 0 && /不代表能力评价/.test(r.data.notice), r.data && r.data.notice);
  r = await get('/api/records?limit=10');
  ok('记录列表', r.status === 200 && r.data.list.length >= 2, r.data && r.data.total);
  r = await post('/api/records/summary', {});
  ok('生成记录摘要', r.status === 200 && r.data.ok !== false && r.data.summary, r.data);
  const stateId = (await get('/api/knowledge-states')).data.list[0].id;
  r = await patch('/api/knowledge-states/' + stateId, { clear: true });
  ok('清除知识点状态', r.status === 200 && r.data.state.state === '未诊断', r.data);
  r = await post('/api/records', {});
  ok('无关联的记录被拒绝', r.status === 400, r.data);

  // ---------- F-10 每日建议 ----------
  r = await get('/api/suggestions/today');
  ok('今日建议生成', r.status === 200 && (r.data.suggestion === null || r.data.suggestion.content), r.data);
  const sug = r.data && r.data.suggestion;
  if (sug) {
    r = await post('/api/suggestions/' + sug.id + '/feedback', { type: 'notinterested' });
    ok('建议反馈：不想学这个', r.status === 200 && r.data.suggestion.status === '不感兴趣', r.data);
    r = await del('/api/suggestions/' + sug.id + '/feedback');
    ok('撤回反馈', r.status === 200, r.data);
    r = await post('/api/suggestions/' + sug.id + '/feedback', { type: 'rest' });
    ok('建议反馈：今天休息', r.status === 200 && r.data.suggestion.status === '已休息', r.data);
    r = await get('/api/suggestions/history');
    ok('建议历史', r.status === 200 && r.data.list.length >= 1, r.data && r.data.list.length);
  }
  r = await get('/api/today');
  ok('休息日/任务数据一致', r.status === 200 && typeof r.data.restToday === 'boolean', r.data && r.data.restToday);

  // ---------- F-05 / F-06 资源 ----------
  r = await get('/api/resources/recommend');
  ok('常态推荐（至少 1 条、最多 5 条，且都附理由与链接）',
    r.status === 200 && r.data.ok !== false && r.data.cards.length >= 1 && r.data.cards.length <= 5 && r.data.cards.every((c) => c.reason && c.url),
    { count: r.data && r.data.cards ? r.data.cards.length : 0, ok: r.data && r.data.ok, error: r.data && r.data.error });
  const card = r.data && r.data.cards && r.data.cards[0];
  if (card) {
    ok('推荐链接指向可访问的原站', /^https:\/\//.test(card.url) && !card.url.includes('undefined'), card.url);
    r = await post('/api/resources/' + card.id + '/not-interested');
    ok('不感兴趣', r.status === 200, r.data);
    r = await get('/api/resources/recommend?refresh=1');
    ok('换一批', r.status === 200 && r.data.ok !== false, r.data && r.data.cards && r.data.cards.length);
  }
  r = await post('/api/resources/dialog', { message: '找一门讲数据结构的入门课' });
  ok('对话式检索返回卡片', r.status === 200 && r.data.ok !== false && (r.data.cards.length > 0 || r.data.question), r.data);
  const dlgCard = r.data && r.data.cards && r.data.cards[0];
  if (dlgCard) {
    r = await post('/api/resources/' + dlgCard.id + '/bookmark');
    ok('收藏资源', r.status === 200 && r.data.bookmark.id, r.data);
    const bmId = r.data.bookmark.id;
    r = await post('/api/resources/' + dlgCard.id + '/bookmark');
    ok('重复收藏被拒绝', r.status === 400, r.data);
    r = await patch('/api/bookmarks/' + bmId, { tags: ['复习', '视频'] });
    ok('收藏打标签', r.status === 200 && r.data.tags.length === 2, r.data);
    r = await post('/api/resources/' + dlgCard.id + '/open');
    ok('打开资源记录', r.status === 200 && r.data.url, r.data);
    r = await get('/api/bookmarks?sort=topic');
    ok('资源库列表', r.status === 200 && r.data.list.length >= 1 && r.data.list[0].lastOpenedAt, r.data && r.data.list.length);
    r = await post('/api/resources/' + dlgCard.id + '/report', { type: 'broken' });
    ok('失效反馈', r.status === 200, r.data);
    r = await post('/api/resources/verify');
    ok('链接核验', r.status === 200, r.data);
    r = await del('/api/bookmarks/' + bmId);
    ok('移除收藏', r.status === 200, r.data);
  }
  r = await get('/api/resources/dialog');
  ok('对话记录可回看', r.status === 200 && r.data.list.length > 0, r.data && r.data.list.length);
  r = await del('/api/resources/dialog');
  ok('清空对话', r.status === 200, r.data);
  r = await post('/api/resources/dialog', { message: '' });
  ok('空消息被拦截', r.status === 400, r.data);

  // ---------- M-01 我的与隐私 ----------
  r = await get('/api/me/overview');
  // 「学习资料分析」已提升为一级页面，不再出现在「我的」列表里（原 9 条 → 8 条）
  ok('我的页面条目齐全（8 条，资料分析已上移）', r.status === 200 && r.data.entries.length === 8 && r.data.entries.every((e) => e.summary) && !r.data.entries.some((e) => e.key === 'documents'), r.data && r.data.entries.length);
  ok('我的页面无压力元素（无红点/连续天数）', r.status === 200 && !JSON.stringify(r.data).match(/红点|连续天数|待办数量/), null);
  r = await get('/api/privacy/data-map');
  ok('数据说明页', r.status === 200 && r.data.categories.length === 8 && r.data.categories.every((c) => c.what && c.purpose), r.data && r.data.categories.length);
  r = await call('GET', '/api/privacy/export');
  ok('数据导出', r.status === 200 && (r.raw || (r.data && r.data.exportedAt)), r.status);
  r = await post('/api/privacy/purge', { scope: 'solve' });
  ok('分类清除', r.status === 200 && r.data.cleared[0] === 'solve', r.data);
  r = await get('/api/solve/history');
  ok('清除后搜题记录为空', r.status === 200 && r.data.total === 0, r.data && r.data.total);

  // ---------- 权限与隔离 ----------
  const user2 = user + 'b';
  const cookie1 = cookie;
  await post('/api/auth/register', { username: user2, password: 'test123456' });
  const cookie2 = cookie;
  r = await get('/api/me/overview');
  ok('第二个用户看不到第一个用户的数据', r.status === 200 && r.data.identity.majorName === '', r.data && r.data.identity);
  cookie = cookie1;
  r = await get('/api/me/overview');
  ok('切回第一个用户数据仍在', r.status === 200 && r.data.identity.majorName !== '', r.data && r.data.identity);
  cookie = '';
  r = await get('/api/me/overview');
  ok('未登录访问被拒绝', r.status === 401, r.status);
  cookie = cookie1;

  // ---------- 清理 ----------
  if (docId) { r = await del('/api/documents/' + docId); ok('删除资料（连同计划）', r.status === 200, r.data); }

  // ---------- 汇总 ----------
  console.log(results.join('\n'));
  console.log('\n合计 ' + results.length + ' 项，失败 ' + failures + ' 项');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('测试异常：', e && e.message);
  console.log(results.join('\n'));
  console.log('\n（异常中断）已执行 ' + results.length + ' 项，失败 ' + failures + ' 项');
  process.exit(2);
});
