'use strict';
const authLib = require('../auth');
const store = require('../store');
const util = require('./util');

function setSessionCookie(res, token, expiresAt) {
  res.setHeader('Set-Cookie', 'sid=' + token + '; Path=/; HttpOnly; SameSite=Lax; Expires=' + new Date(expiresAt).toUTCString());
}
function clearCookie(res) { res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); }

async function register(ctx) {
  const { username, password, nickname } = ctx.body;
  let user;
  try { user = authLib.register(username, password, nickname); }
  catch (e) { throw new util.HttpError(400, e.message); }
  const s = authLib.createSession(user.id);
  setSessionCookie(ctx.res, s.token, s.expiresAt);
  return { user: publicUser(user) };
}
async function login(ctx) {
  let user;
  try { user = authLib.login(ctx.body.username, ctx.body.password); }
  catch (e) { throw new util.HttpError(400, e.message); }
  const s = authLib.createSession(user.id);
  setSessionCookie(ctx.res, s.token, s.expiresAt);
  return { user: publicUser(user) };
}
async function logout(ctx) {
  const t = authLib.tokenFrom(ctx.req);
  if (t) authLib.destroySession(t);
  clearCookie(ctx.res);
  return { ok: true };
}
function publicUser(u) { return { id: u.id, username: u.username, nickname: u.nickname, createdAt: u.createdAt }; }

async function me(ctx) {
  const user = ctx.user;
  if (!user) return { user: null, profile: null, flags: { hasProfile: false, profileSkipped: false } };
  const profile = util.profileOf(user.id);
  return {
    user: publicUser(user),
    profile,
    flags: {
      hasProfile: !!profile.complete,
      profileSkipped: !!profile.skipped,
      hasSelfReport: !!store.find('selfReportItems', (i) => i.userId === user.id).length,
      hasGoal: store.find('goals', (g) => g.userId === user.id).length > 0,
      hasTime: !!store.one('timeConstraints', (t) => t.userId === user.id),
      documentCount: store.find('documents', (d) => d.userId === user.id).length,
      planCount: store.find('studyPlans', (p) => p.userId === user.id && p.status === '进行中').length,
      solveCount: store.find('questionRecords', (q) => q.userId === user.id).length,
      bookmarkCount: store.find('resourceBookmarks', (b) => b.userId === user.id).length
    }
  };
}

module.exports = {
  'POST /api/auth/register': register,
  'POST /api/auth/login': login,
  'POST /api/auth/logout': logout,
  'GET /api/auth/me': me
};
