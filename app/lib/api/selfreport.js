'use strict';
// F-07 学生自定义信息（我的学习情况）与 AI 提炼素材
const store = require('../store');
const util = require('./util');
const workers = require('../../workers');

const MAX_LEN = 2000;

function current(userId) { return store.one('selfReports', (r) => r.userId === userId) || null; }

async function getReport(ctx) {
  const user = util.auth(ctx);
  const rep = current(user.id);
  const items = rep ? store.find('selfReportItems', (i) => i.reportId === rep.id) : [];
  return {
    rawText: rep ? rep.rawText : '', status: rep ? rep.status : 'empty', skipped: rep ? !!rep.skipped : false,
    updatedAt: rep ? rep.updatedAt || rep.createdAt : null, maxLen: MAX_LEN,
    items: items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  };
}

async function saveReport(ctx) {
  const user = util.auth(ctx);
  const b = ctx.body || {};
  const skip = !!b.skip;
  const rawText = String(b.rawText || '').slice(0, MAX_LEN);
  if (!skip) util.need(rawText.trim().length >= 4, '写几句话就好，比如学过哪些课、正在学什么');
  const rep = current(user.id);
  if (rep) {
    store.update('selfReports', (r) => r.id === rep.id, { rawText, skipped: skip, status: skip ? 'skipped' : 'pending' });
  } else {
    store.insert('selfReports', { userId: user.id, rawText, skipped: skip, status: skip ? 'skipped' : 'pending' });
  }
  const saved = current(user.id);
  if (!skip) util.async(() => workers.extractSelfReport(saved.id));
  return { report: await getReport(ctx) };
}

async function patchItem(ctx) {
  const user = util.auth(ctx);
  const it = store.one('selfReportItems', (i) => i.id === ctx.params.id && i.userId === user.id);
  util.need(it, '条目不存在', 404);
  const patch = {};
  if (ctx.body.adopted !== undefined) patch.adopted = !!ctx.body.adopted;
  if (ctx.body.content !== undefined) patch.content = String(ctx.body.content).slice(0, 300);
  if (ctx.body.itemType !== undefined) patch.itemType = String(ctx.body.itemType).slice(0, 20);
  patch.edited = true;
  store.update('selfReportItems', (i) => i.id === it.id, patch);
  // 学生修正后以学生版本为准，同步素材
  const rep = current(user.id);
  if (rep) {
    const items = store.find('selfReportItems', (i) => i.reportId === rep.id && i.adopted !== false);
    workers.upsertMaterial(user.id, 'self_report', {
      objective: items.filter((i) => i.sourceType === 'objective').map((i) => i.content),
      subjective: items.filter((i) => i.sourceType === 'subjective').map((i) => '学生自述（非能力判定）：' + i.content)
    }, { kind: 'self_report', id: rep.id });
  }
  return { item: store.one('selfReportItems', (i) => i.id === it.id) };
}

async function deleteItem(ctx) {
  const user = util.auth(ctx);
  store.remove('selfReportItems', (i) => i.id === ctx.params.id && i.userId === user.id);
  return { ok: true };
}

async function clearReport(ctx) {
  const user = util.auth(ctx);
  const rep = current(user.id);
  if (rep) {
    store.remove('selfReportItems', (i) => i.reportId === rep.id);
    store.remove('selfReports', (r) => r.id === rep.id);
  }
  store.remove('promptMaterials', (m) => m.userId === user.id && m.module === 'self_report');
  return { ok: true };
}

async function reExtract(ctx) {
  const user = util.auth(ctx);
  const rep = current(user.id);
  util.need(rep && rep.rawText, '还没有可提炼的内容');
  store.update('selfReports', (r) => r.id === rep.id, { status: 'pending' });
  util.async(() => workers.extractSelfReport(rep.id));
  return { ok: true };
}

module.exports = {
  'GET /api/self-report': getReport,
  'POST /api/self-report': saveReport,
  'POST /api/self-report/re-extract': reExtract,
  'DELETE /api/self-report': clearReport,
  'PATCH /api/self-report/items/:id': patchItem,
  'DELETE /api/self-report/items/:id': deleteItem
};
