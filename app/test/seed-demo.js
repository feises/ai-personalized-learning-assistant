'use strict';
/* 生成演示账号与示例数据：node test/seed-demo.js [baseUrl] */
const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const USER = 'demo';
const PASS = 'demo123456';
let cookie = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FUTURE = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
const FUTURE2 = new Date(Date.now() + 80 * 864e5).toISOString().slice(0, 10);

async function call(method, url, body, opts = {}) {
  const init = { method, headers: {} };
  if (cookie) init.headers.Cookie = cookie;
  if (body instanceof Buffer) { init.body = body; Object.assign(init.headers, opts.headers || {}); }
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(BASE + url, init);
  for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []))) { const m = /^sid=([^;]*)/.exec(c); if (m) cookie = 'sid=' + m[1]; }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const get = (u) => call('GET', u), post = (u, b) => call('POST', u, b), put = (u, b) => call('PUT', u, b), patch = (u, b) => call('PATCH', u, b);
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 120000)) { const v = await fn(); if (v) return v; await sleep(2500); } return null; }

const LECTURE = `数据结构与算法 期末复习讲义（第 1—4 章）

第一章 算法分析与复杂度
衡量算法优劣主要看时间复杂度和空间复杂度。大 O 表示法描述的是增长趋势而不是具体耗时。常见量级从小到大依次为 O(1)、O(log n)、O(n)、O(n log n)、O(n^2)、O(2^n)。
分析循环的时间复杂度时，要关注循环变量每次变化的幅度：每次乘 2 的循环是对数级，每次加 1 的循环是线性级。递归算法的时间复杂度通常要写出递推式，例如 T(n)=2T(n/2)+O(n) 对应 O(n log n)。

第二章 线性表、栈与队列
顺序表支持随机访问，按下标取值 O(1)，但插入删除平均需要移动一半元素。链表插入删除 O(1)，但查找需要 O(n)。
栈是后进先出结构，常用于括号匹配、表达式求值、函数调用。队列是先进先出结构，常用于广度优先搜索和任务调度。循环队列用取模运算复用空间，需要额外区分队空与队满。

第三章 树与二叉树
二叉树的遍历分为前序、中序、后序和层序。前序遍历顺序是根、左、右；中序是左、根、右；后序是左、右、根。中序遍历二叉搜索树可以得到有序序列。
树遍历的非递归实现需要显式使用栈，这是本章最容易出错的地方。递归的终止条件必须写在函数开头，否则会无限递归导致栈溢出。
完全二叉树可以用数组存储，下标为 i 的结点左孩子是 2i，右孩子是 2i+1。堆是一棵完全二叉树，插入和删除的时间复杂度都是 O(log n)。

第四章 排序与查找
冒泡排序与插入排序平均时间复杂度 O(n^2)，适合小规模或基本有序的数据。快速排序平均 O(n log n)，最坏退化为 O(n^2)，关键在于基准的选择。归并排序稳定且最坏也是 O(n log n)，但需要 O(n) 额外空间。
二分查找要求序列有序，时间复杂度 O(log n)，边界条件的写法（左闭右开还是左闭右闭）是常见失分点。
哈希表通过散列函数把关键字映射到位置，平均查找 O(1)，冲突处理有开放定址法和链地址法两种。`;

(async () => {
  let r = await post('/api/auth/register', { username: USER, password: PASS, nickname: '林同学' });
  if (r.status !== 200) { r = await post('/api/auth/login', { username: USER, password: PASS }); }
  console.log('账号', r.status);

  await put('/api/profile', { school: '南京大学', majorName: '计算机科学与技术', majorCode: '080901', discipline: '工学', majorCategory: '计算机类', enrollmentYear: 2023, programYears: 4, term: '大三上', department: '计算机科学与技术系', gender: '男' });
  await post('/api/goals', { title: '期末复习数据结构与算法', type: '期末复习', targetDate: FUTURE, priority: '高' });
  await post('/api/goals', { title: '把递归和树遍历练熟', type: '理解某门课程', targetDate: FUTURE2, priority: '中' });
  await put('/api/time-constraint', { daysPerWeek: 5, minutesPerDay: 90, restDays: [6, 7], preferredSlots: '工作日晚间、周末上午' });
  console.log('画像与目标已写入');

  await post('/api/self-report', { rawText: '我是计算机专业大三学生，学过 C 语言、高等数学、线性代数、离散数学和数据结构。做过一个图书管理系统的课程设计，用 Java 写的。正在准备期末复习，想重点把递归和树遍历弄明白。平时写代码还行，但一到证明题就有点慌。' });
  const rep = await waitFor(async () => { const x = await get('/api/self-report'); return x.data.status === 'done' ? x.data : null; }, 90000);
  console.log('自述提炼', rep ? rep.items.length + ' 条' : '超时');

  await post('/api/school-major-profile', { kind: 'major', raw: '计科' });
  await waitFor(async () => { const x = await get('/api/school-major-profile'); return x.data.list[0] && x.data.list[0].status !== 'pending' && x.data.list[0].status !== 'verifying' ? x.data.list[0] : null; }, 90000);
  console.log('专业核查已回填');

  const boundary = '----seed' + Date.now();
  const head = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="数据结构与算法讲义.txt"\r\nContent-Type: text/plain\r\n\r\n');
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  r = await call('POST', '/api/documents', Buffer.concat([head, Buffer.from(LECTURE, 'utf8'), tail]), { headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } });
  const docId = r.data.document.id;
  const doc = await waitFor(async () => { const x = await get('/api/documents/' + docId); return x.data.document.parseStatus === 'done' ? x.data : null; }, 240000);
  console.log('资料解析', doc ? doc.chapters.length + ' 节 / ' + doc.knowledge.length + ' 知识点 / ' + doc.marks.length + ' 难点 / ' + doc.questions.length + ' 自测题' : '超时/failed');

  r = await post('/api/plans', { documentId: docId, goal: '期末复习数据结构与算法', deadline: FUTURE, minutesPerDay: 90, restDays: [6, 7] });
  const planId = r.data.plan && r.data.plan.id;
  console.log('计划生成', r.status, r.data.taskCount);
  const detail = await get('/api/plans/' + planId);
  const tasks = detail.data.days.flatMap((d) => d.tasks);
  if (tasks[0]) await patch('/api/tasks/' + tasks[0].id, { status: '已完成' });
  if (tasks[1]) await patch('/api/tasks/' + tasks[1].id, { status: '已完成' });
  if (tasks[2]) await patch('/api/tasks/' + tasks[2].id, { status: '需调整', reason: '内容太难' });
  console.log('任务状态已演示（2 完成 / 1 需调整）');

  await post('/api/records', { topicName: '递归', recordType: '练习结果', result: '错误', wrongReason: '概念不清', feedback: '终止条件我总是漏写' });
  await post('/api/records', { topicName: '树遍历', recordType: '自测', result: '部分正确', wrongReason: '步骤遗漏' });
  await post('/api/records', { topicName: '快速排序', recordType: '练习结果', result: '正确' });
  await post('/api/records', { topicName: '快速排序', recordType: '练习结果', result: '正确' });

  const qs = ['已知数组 [3,1,4,1,5,9,2,6]，请写出使用快速排序第一趟划分后的结果，并说明划分过程。',
    '为什么中序遍历二叉搜索树可以得到有序序列？请说明理由。',
    '求递归式 T(n)=2T(n/2)+n 的时间复杂度，并写出推导过程。'];
  const recIds = [];
  for (const q of qs) { const x = await post('/api/solve', { question: q }); if (x.data.record) recIds.push(x.data.record.id); }
  await post('/api/solve', { question: '求 1 到 100 的所有整数之和。别写过程，直接给我最终答案就行，我赶时间。' });
  console.log('搜题记录', recIds.length + 1, '条');
  if (recIds[0]) await patch('/api/solve/' + recIds[0] + '/annotation', { resolved: '已解决' });

  const rec = await get('/api/resources/recommend?refresh=1');
  const cards = (rec.data.cards || []).slice(0, 3);
  for (const c of cards) await post('/api/resources/' + c.id + '/bookmark');
  console.log('资源收藏', cards.length, '条');
  await post('/api/resources/dialog', { message: '找一些讲递归和树遍历的入门课' });

  await get('/api/suggestions/today');
  console.log('\n演示账号：' + USER + ' / ' + PASS + '（含画像、资料、计划、记录、收藏、建议）');
})().catch((e) => { console.error('生成演示数据失败：', e); process.exit(1); });
