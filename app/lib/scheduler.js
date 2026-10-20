'use strict';
// 计划排期：日期由后端规则计算，模型只负责内容（单元、标准、理由）。
const { addDays, nextWorkday, isRestDay } = require('./api/util');

const DEFAULT_MINUTES = 60;

/** 把学习单元排到具体日期：每天只用可用时长的 80%，休息日跳过，前置单元自然靠前。 */
function buildSchedule(units, opts = {}) {
  const minutesPerDay = Number(opts.minutesPerDay) > 0 ? Number(opts.minutesPerDay) : DEFAULT_MINUTES;
  const restDays = opts.restDays || [];
  const cap = Math.max(20, Math.floor(minutesPerDay * 0.8));
  let date = nextWorkday(opts.startDate, restDays);
  let used = 0;
  const out = [];
  for (const u of units) {
    const raw = Number(u.minutes) || 25;
    const m = Math.max(10, Math.min(raw, cap));
    if (used > 0 && used + m > cap) { date = nextWorkday(addDays(date, 1), restDays); used = 0; }
    out.push({
      title: u.title, actionType: u.action || '阅读资料', estimatedMinutes: m, plannedDate: date,
      completionCriteria: u.completionCriteria || '能用一句话复述本节要点', reason: u.reason || '',
      chapter: u.chapter || '', knowledgePoints: u.knowledgePoints || [], priority: out.length < 3 ? '高' : '中',
      status: '待开始', source: u.source || '计划生成'
    });
    used += m;
  }
  return out;
}

/** 重排未完成任务：保持顺序与优先级，按剩余容量重新分配日期。 */
function reschedulePending(tasks, opts = {}) {
  const pending = tasks.filter((t) => t.status === '待开始' || t.status === '需调整' || t.status === '进行中');
  if (!pending.length) return { changes: [], tasks };
  const ordered = pending.slice().sort((a, b) => {
    const pr = { 高: 0, 中: 1, 低: 2 };
    return (pr[a.priority] ?? 1) - (pr[b.priority] ?? 1) || String(a.plannedDate).localeCompare(String(b.plannedDate));
  });
  const units = ordered.map((t) => ({
    title: t.title, action: t.actionType, minutes: t.estimatedMinutes, completionCriteria: t.completionCriteria,
    reason: t.reason, chapter: t.chapter, knowledgePoints: t.knowledgePoints, source: t.source
  }));
  const scheduled = buildSchedule(units, {
    startDate: opts.startDate, minutesPerDay: opts.minutesPerDay, restDays: opts.restDays
  });
  const changes = [];
  ordered.forEach((t, i) => {
    const to = scheduled[i] && scheduled[i].plannedDate;
    if (to && to !== t.plannedDate) changes.push({ taskId: t.id, title: t.title, from: t.plannedDate, to });
    if (to) t.plannedDate = to;
    if (t.status === '需调整') t.status = '待开始';
  });
  return { changes, tasks };
}

module.exports = { buildSchedule, reschedulePending, DEFAULT_MINUTES };
