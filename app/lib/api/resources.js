'use strict';
// F-05 资源搜索推送（对话式 + 常态推荐）、F-06 资源库（收藏夹）
const store = require('../store');
const prompts = require('../prompts');
const ai = require('../ai');
const util = require('./util');
const workers = require('../../workers');

const BOOKMARK_LIMIT = 200;

function decorate(userId, resource) {
  const marked = !!store.one('resourceBookmarks', (b) => b.userId === userId && b.resourceId === resource.id);
  return Object.assign({}, resource, { bookmarked: marked });
}
function lastBatch(userId) {
  const batches = store.find('recommendationBatches', (b) => b.userId === userId);
  return batches[batches.length - 1] || null;
}
function batchOf(userId) {
  const last = lastBatch(userId);
  if (!last) return [];
  return last.resourceIds.map((id) => store.one('resources', (r) => r.id === id)).filter(Boolean);
}

async function recommend(ctx) {
  const user = util.auth(ctx);
  const aiCfg = ai.readConfig();
  let cards = batchOf(user.id);
  const refresh = ctx.query.refresh === '1';
  // 跨天自动换新一批（不需要学生手动触发），同一天内保持稳定
  const last = lastBatch(user.id);
  const stale = !last || String(last.at || '').slice(0, 10) !== util.today();
  if (refresh || !cards.length || stale) {
    const exclude = cards.map((c) => c.title);
    const res = await workers.refreshRecommendations(user.id, exclude);
    if (!res.ok) {
      return { ok: false, cards: refresh || stale ? cards.map((c) => decorate(user.id, c)) : [], error: '推荐暂时没有生成出来' };
    }
    cards = res.resources;
  }
  return { ok: true, cards: cards.map((c) => decorate(user.id, c)), model: aiCfg.model, refreshed: refresh || stale };
}

function clarifyCount(userId) {
  const list = store.find('resourceDialogs', (d) => d.userId === userId);
  return list.slice(-6).filter((d) => d.role === 'assistant' && d.asked).length;
}

async function dialog(ctx) {
  const user = util.auth(ctx);
  const message = String((ctx.body || {}).message || '').trim();
  util.need(message, '说一句话说明你想找什么');
  util.need(message.length <= 300, '这句话太长了，简单说说就好');
  store.insert('resourceDialogs', { userId: user.id, role: 'user', content: message });
  store.insert('resourceBehaviors', { userId: user.id, action: '搜索', keyword: message.slice(0, 60) });

  const history = store.find('resourceDialogs', (d) => d.userId === user.id).slice(-10)
    .map((d) => ({ role: d.role, content: d.content }));
  const profile = util.aiContext(user.id);
  const exclude = store.find('resources', (r) => r.userId === user.id).slice(-12).map((r) => r.title);
  const forceCards = clarifyCount(user.id) >= 2;
  const msgs = prompts.resourceDialogMessages({ dialogue: history, profile, exclude });
  if (forceCards) msgs[0].content += '\n不要再追问，直接给出 cards。';

  const res = await ai.chatJSON(msgs, {
    purpose: 'resource-dialog', userId: user.id, maxTokens: 4096,
    validate: (o) => (o && typeof o.reply === 'string' && Array.isArray(o.cards) ? [] : ['缺少 reply 或 cards'])
  });
  if (!res.ok) {
    return { ok: false, error: '这次没查出来，换个说法再试试' };
  }
  const d = res.data;
  const reply = String(d.reply || '').slice(0, 300);
  const question = String(d.question || '').slice(0, 200);
  store.insert('resourceDialogs', { userId: user.id, role: 'assistant', content: reply + (question ? ' ' + question : ''), asked: !!question });

  const cards = (d.cards || []).slice(0, 5).map(util.normalizeCard).map((c) => {
    const key = c.title + '|' + c.platform;
    let item = store.one('resources', (r) => r.userId === user.id && r.key === key);
    if (item) { store.update('resources', (r) => r.id === item.id, { lastRecommendedAt: store.now() }); return item; }
    return store.insert('resources', Object.assign({ userId: user.id, key, openCount: 0, lastRecommendedAt: store.now() }, c));
  });
  store.insert('resourceBehaviors', { userId: user.id, action: '检索结果', count: cards.length, keyword: message.slice(0, 60) });
  return { ok: true, reply, question, cards: cards.map((c) => decorate(user.id, c)), forced: forceCards };
}

async function dialogHistory(ctx) {
  const user = util.auth(ctx);
  return { list: store.find('resourceDialogs', (d) => d.userId === user.id).map((d) => ({ id: d.id, role: d.role, content: d.content, createdAt: d.createdAt })) };
}
async function clearDialog(ctx) {
  const user = util.auth(ctx);
  store.remove('resourceDialogs', (d) => d.userId === user.id);
  return { ok: true };
}

async function bookmark(ctx) {
  const user = util.auth(ctx);
  const r = store.one('resources', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(r, '资源不存在', 404);
  util.need(!store.one('resourceBookmarks', (b) => b.userId === user.id && b.resourceId === r.id), '这条已经在资源库里了');
  const count = store.find('resourceBookmarks', (b) => b.userId === user.id).length;
  util.need(count < BOOKMARK_LIMIT, '资源库已满（' + BOOKMARK_LIMIT + ' 条），先清理一些再收藏');
  const b = store.insert('resourceBookmarks', { userId: user.id, resourceId: r.id, addedAt: store.now(), tags: [], openCount: 0, lastOpenedAt: null });
  store.insert('resourceBehaviors', { userId: user.id, action: '收藏', resourceId: r.id });
  return { bookmark: b };
}

async function listBookmarks(ctx) {
  const user = util.auth(ctx);
  let list = store.find('resourceBookmarks', (b) => b.userId === user.id).map((b) => {
    const r = store.one('resources', (x) => x.id === b.resourceId);
    return r ? Object.assign({}, r, { bookmarkId: b.id, addedAt: b.addedAt, tags: b.tags || [], openCount: r.openCount || 0, lastOpenedAt: b.lastOpenedAt || r.lastOpenedAt || null }) : null;
  }).filter(Boolean);
  if (ctx.query.q) list = list.filter((b) => b.title.includes(ctx.query.q) || (b.topic || '').includes(ctx.query.q));
  if (ctx.query.tag) list = list.filter((b) => (b.tags || []).includes(ctx.query.tag));
  const sort = ctx.query.sort || 'added';
  if (sort === 'topic') list.sort((a, b) => String(a.topic).localeCompare(String(b.topic), 'zh'));
  else if (sort === 'recent') list.sort((a, b) => String(b.lastOpenedAt || '').localeCompare(String(a.lastOpenedAt || '')));
  else list.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  const tags = Array.from(new Set(list.flatMap((x) => x.tags || [])));
  return { list, total: list.length, limit: BOOKMARK_LIMIT, tags };
}

async function patchBookmark(ctx) {
  const user = util.auth(ctx);
  const b = store.one('resourceBookmarks', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(b, '收藏不存在', 404);
  const tags = (Array.isArray(ctx.body.tags) ? ctx.body.tags : []).map((t) => String(t).slice(0, 12)).filter(Boolean).slice(0, 6);
  store.update('resourceBookmarks', (x) => x.id === b.id, { tags });
  return { ok: true, tags };
}

async function removeBookmark(ctx) {
  const user = util.auth(ctx);
  store.remove('resourceBookmarks', (b) => b.id === ctx.params.id && b.userId === user.id);
  return { ok: true };
}

async function openResource(ctx) {
  const user = util.auth(ctx);
  const r = store.one('resources', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(r, '资源不存在', 404);
  store.update('resources', (x) => x.id === r.id, { openCount: (r.openCount || 0) + 1, lastOpenedAt: store.now() });
  store.update('resourceBookmarks', (b) => b.userId === user.id && b.resourceId === r.id, { openCount: (r.openCount || 0) + 1, lastOpenedAt: store.now() });
  store.insert('resourceBehaviors', { userId: user.id, action: '打开', resourceId: r.id });
  return { ok: true, url: r.url };
}

async function reportResource(ctx) {
  const user = util.auth(ctx);
  const r = store.one('resources', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(r, '资源不存在', 404);
  const type = ctx.body.type === 'infringe' ? '侵权' : '链接失效';
  store.insert('resourceFeedbacks', { userId: user.id, resourceId: r.id, type, note: String(ctx.body.note || '').slice(0, 300) });
  if (type === '链接失效') store.update('resources', (x) => x.id === r.id, { linkStatus: '已失效', lastVerifiedAt: store.now() });
  return { ok: true };
}

async function notInterested(ctx) {
  const user = util.auth(ctx);
  const r = store.one('resources', (x) => x.id === ctx.params.id && x.userId === user.id);
  util.need(r, '资源不存在', 404);
  const until = new Date(Date.now() + 30 * 864e5).toISOString();
  const exist = store.one('resourcePreferences', (p) => p.userId === user.id && p.topic === r.topic);
  if (exist) store.update('resourcePreferences', (p) => p.id === exist.id, { until });
  else store.insert('resourcePreferences', { userId: user.id, topic: r.topic, until });
  store.insert('resourceBehaviors', { userId: user.id, action: '不感兴趣', resourceId: r.id });
  return { ok: true, topic: r.topic, until };
}

async function verifyNow(ctx) {
  const user = util.auth(ctx);
  const list = store.find('resources', (r) => r.userId === user.id && r.linkStatus !== '已失效').slice(0, 8);
  for (const r of list) await workers.verifyResource(r.id);
  return { ok: true, checked: list.length };
}

module.exports = {
  'GET /api/resources/recommend': recommend,
  'POST /api/resources/dialog': dialog,
  'GET /api/resources/dialog': dialogHistory,
  'DELETE /api/resources/dialog': clearDialog,
  'POST /api/resources/verify': verifyNow,
  'POST /api/resources/:id/bookmark': bookmark,
  'POST /api/resources/:id/open': openResource,
  'POST /api/resources/:id/report': reportResource,
  'POST /api/resources/:id/not-interested': notInterested,
  'GET /api/bookmarks': listBookmarks,
  'PATCH /api/bookmarks/:id': patchBookmark,
  'DELETE /api/bookmarks/:id': removeBookmark
};
