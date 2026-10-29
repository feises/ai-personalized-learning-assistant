'use strict';
/* 页面：学习资源推送 / AI 找资源 / 我的（含全部子页） */
(function () {
  const A = App;

  /* ------------------- 资源卡片（推送与检索共用） ------------------- */
  // opts.feedback 为 true 时，卡片右下角额外给出「不感兴趣」
  function cardHtml(c, opts) {
    const accessKind = c.access === '免费' ? 'ok' : 'warn';
    return '<div class="rcard"><div class="row between"><div class="r-title">' + A.esc(c.title) + '</div>' + A.chip(c.type) + '</div>' +
      '<div class="r-intro">' + A.esc(c.intro || '') + '</div>' +
      '<div class="chips">' + A.chip(c.platformName || '', 'plain') + A.chip(c.access, accessKind) + (c.topic ? A.chip(c.topic) : '') + (c.linkStatus && c.linkStatus !== '可用' ? A.chip(c.linkStatus, 'warn') : '') + '</div>' +
      (c.audience ? '<div class="tiny muted">适合：' + A.esc(c.audience) + '</div>' : '') +
      '<div class="row mt8"><button class="btn sm" data-open="' + c.id + '">打开原站</button>' +
      (c.bookmarked ? '<span class="chip ok">已收藏</span>' : '<button class="btn sm soft" data-mark="' + c.id + '">收藏</button>') +
      (opts && opts.feedback ? '<button class="btn sm ghost" data-no="' + c.id + '">不感兴趣</button>' : '') + '</div></div>';
  }
  function bindCards(root) {
    A.$$('[data-open]', root).forEach((b) => (b.onclick = async () => {
      const r = await A.post('/api/resources/' + b.dataset.open + '/open');
      A.confirmDialog('即将离开本平台', '资源在原始网站打开，我们只保存了链接。', () => window.open(r.url, '_blank', 'noopener'));
    }));
    A.$$('[data-mark]', root).forEach((b) => (b.onclick = async () => {
      try { await A.post('/api/resources/' + b.dataset.mark + '/bookmark'); A.toast('已收进资源库', 'ok'); A.route(); } catch (e) { A.toast(e.message, 'err'); }
    }));
    A.$$('[data-no]', root).forEach((b) => (b.onclick = async () => {
      try { await A.post('/api/resources/' + b.dataset.no + '/not-interested'); A.toast('这个方向会少推一些', 'ok'); A.route(); } catch (e) { A.toast(e.message, 'err'); }
    }));
  }

  /* ===================== 学习资源推送（只做自动推送） ===================== */
  A.register('resources', async () => {
    if (!(await A.needProfile())) return;
    // 本页只负责常态推荐；按需求检索在独立的「AI 找资源」
    let snap = { ok: true, cards: [], pending: true };
    A.render(A.head('学习资源推送', '按你的画像和最近关注挑选，每天更新', '<div class="row"><a class="btn sm" href="#/find">AI 找资源</a><a class="btn sm" href="#/me/library">我的资源库</a></div>') +
      '<div class="card"><div class="card-title"><h3>给你推的</h3><button class="btn sm" id="renew">换一批</button></div><div id="rec" class="cards-grid"></div></div>' +
      '<p class="muted small mt12">推荐来自公开平台，链接指向各平台的检索页；点「打开原站」会离开本平台。</p>');
    function drawRec() {
      const box = A.$('#rec');
      if (!box) return;
      if (snap.pending) { box.innerHTML = '<div class="empty">正在为你挑选…</div>'; return; }
      if (!snap.ok || !snap.cards.length) {
        box.innerHTML = A.empty('暂时没有推荐', '可以换一批再试，或按需求直接检索', '<a class="btn primary sm" href="#/find">AI 找资源</a>');
        return;
      }
      box.innerHTML = snap.cards.map((c) => cardHtml(c, { feedback: true })).join('');
      bindCards(box);
    }
    drawRec();
    // 推荐需要模型挑选，异步取；拿到后只刷新推荐区
    A.get('/api/resources/recommend').then((r) => {
      snap = r || { ok: false, cards: [] };
      snap.pending = false;
      drawRec();
    }).catch(() => { snap = { ok: false, cards: [], pending: false }; drawRec(); });
    A.$('#renew').onclick = async () => {
      try { A.loading(true, '正在换一批…'); const r = await A.get('/api/resources/recommend?refresh=1'); A.loading(false); if (r.ok) { r.pending = false; snap = r; drawRec(); } else A.toast(r.error || '没换出来', 'err'); }
      catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    };
  });

  /* ============================ AI 找资源 ============================ */
  A.register('find', async () => {
    if (!(await A.needProfile())) return;
    const dialogs = await A.get('/api/resources/dialog');
    const SAMPLES = ['找二叉树遍历视频', '推荐递归练习题', '找适合零基础的排序课程'];
    A.render(A.head('AI 找资源', '说出主题、基础水平和偏好的资源形式', '<div class="row"><a class="btn sm" href="#/resources">看推荐</a><a class="btn sm" href="#/me/library">我的资源库</a></div>') +
      '<div class="ai-panel">' +
      '<textarea id="msg" rows="3" class="ai-input"></textarea>' +
      '<div class="ai-chips">' + SAMPLES.map((q) => '<button type="button" class="ai-chip" data-q="' + A.esc(q) + '">' + A.esc(q) + '</button>').join('') + '</div>' +
      '<div class="ai-actions"><button class="btn primary" id="send">' + A.I.search + 'AI 搜索资源</button></div>' +
      '</div>' +
      '<div class="card"><div class="card-title"><h3>检索记录</h3><button class="btn sm ghost" id="clr">清空记录</button></div>' +
      '<div class="stream" id="stream"></div></div>');

    function drawStream() {
      const box = A.$('#stream');
      if (!box) return;
      box.innerHTML = dialogs.list.length
        ? dialogs.list.map((d) => '<div class="bubble ' + (d.role === 'user' ? 'user' : 'bot') + '">' + A.esc(d.content) + '</div>').join('')
        : '<p class="muted small">还没有检索记录。说一句你想学的，或点上面的示例词。</p>';
      if (window.__lastCards && window.__lastCards.length) {
        box.insertAdjacentHTML('beforeend', '<div class="cards-grid" id="lastcards">' + window.__lastCards.map((c) => cardHtml(c, {})).join('') + '</div>');
        bindCards(A.$('#lastcards'));
      }
      box.scrollTop = box.scrollHeight;
    }
    drawStream();

    async function send() {
      const box = A.$('#msg');
      const btn = A.$('#send');
      const m = box.value.trim();
      if (!m) { box.focus(); return; }
      box.value = '';
      if (btn) { btn.disabled = true; btn.dataset.html = btn.innerHTML; btn.textContent = '正在找…'; }
      A.$('#stream').insertAdjacentHTML('beforeend', '<div class="bubble user">' + A.esc(m) + '</div>');
      A.$('#stream').insertAdjacentHTML('beforeend', '<div class="bubble bot" id="thinking">正在找…</div>');
      A.$('#stream').scrollTop = A.$('#stream').scrollHeight;
      try {
        const r = await A.post('/api/resources/dialog', { message: m });
        const t = A.$('#thinking'); if (t) t.remove();
        if (!r.ok) { A.$('#stream').insertAdjacentHTML('beforeend', '<div class="bubble ask">' + A.esc(r.error || '没有找到，换个说法再试试') + '</div>'); return; }
        A.$('#stream').insertAdjacentHTML('beforeend', '<div class="bubble bot">' + A.esc(r.reply + (r.question ? ' ' + r.question : '')) + '</div>');
        const old = A.$('#lastcards'); if (old) old.remove();
        window.__lastCards = r.cards || [];
        if (window.__lastCards.length) {
          A.$('#stream').insertAdjacentHTML('beforeend', '<div class="cards-grid" id="lastcards">' + window.__lastCards.map((c) => cardHtml(c, {})).join('') + '</div>');
          bindCards(A.$('#lastcards'));
        }
        A.$('#stream').scrollTop = A.$('#stream').scrollHeight;
      } catch (e) {
        const t = A.$('#thinking'); if (t) t.remove();
        A.$('#stream').insertAdjacentHTML('beforeend', '<div class="bubble ask">' + A.esc(e.message) + '</div>');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.html; }
      }
    }
    A.$('#send').onclick = send;
    // 示例词：点一下直接发起检索
    A.$$('.ai-chip').forEach((b) => (b.onclick = () => { A.$('#msg').value = b.dataset.q; send(); }));
    // 回车发送、Shift+回车换行；中文输入法组词时的回车不触发发送
    A.$('#msg').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    A.$('#clr').onclick = () => A.confirmDialog('清空检索记录？', '只清空记录，已收藏的资源还在。', async () => { await A.del('/api/resources/dialog'); window.__lastCards = []; A.toast('已清空', 'ok'); A.route(); }, '清空');
  });

  /* ============================== 我的 ============================== */
  A.register('me', async () => {
    const d = await A.get('/api/me/overview');
    const id = d.identity;
    const zoneName = { B: '我的信息', C: '我的学习', D: '数据与隐私' };
    const href = { basic: 'me/profile', goal: 'me/goals', entity: 'me/entity', selfreport: 'me/selfreport', growth: 'me/growth', library: 'me/library', suggestions: 'me/suggestions', privacy: 'me/privacy' };
    let html = A.head('我的');
    html += '<div class="card"><div class="row between"><div><div class="row"><div style="width:46px;height:46px;border-radius:14px;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center;font-weight:700;font-size:18px">' + A.esc((id.nickname || '学')[0]) + '</div>' +
      '<div><b style="font-size:16px">' + A.esc(id.nickname || '') + '</b><div class="muted small">' + [id.school, id.majorName, id.grade, id.educationLevel].filter(Boolean).join(' · ') + '</div></div></div></div>' +
      '<a class="btn sm" href="#/me/profile">编辑</a></div></div>';
    for (const zone of ['B', 'C', 'D']) {
      html += '<div class="section-title">' + zoneName[zone] + '</div><div class="col">';
      html += d.entries.filter((e) => e.zone === zone).map((e) =>
        '<a class="entry" href="#/' + href[e.key] + '"><div class="ic">' + A.zoneIcon[zone] + '</div><div class="li-main"><div class="li-title">' + A.esc(e.name) + '</div><div class="li-sub">' + A.esc(e.summary) + '</div></div>' + A.statusChip(e.state) + '</a>').join('');
      html += '</div>';
    }
    A.render(html);
  });

  /* --------------------------- 基本信息 --------------------------- */
  A.register('me/profile', async () => {
    const d = await A.get('/api/profile');
    const p = d.profile;
    const schools = await A.get('/api/presets/schools?q=' + encodeURIComponent(p.school || ''));
    const tree = (await A.get('/api/presets/majors/tree')).tree;
    const majors = await A.get('/api/presets/majors?q=' + encodeURIComponent(p.majorName || ''));
    A.render(A.backBar('我的') + A.head('基本信息', '这些只影响讲题和计划的语境') +
      '<div class="card"><div class="grid two">' +
      '<div class="field"><label>院校</label><input id="school" value="' + A.esc(p.school) + '" list="schoolopts"><datalist id="schoolopts">' + schools.list.map((s) => '<option value="' + A.esc(s.name) + '">').join('') + '</datalist></div>' +
      '<div class="field"><label>学院 / 系别（选填）</label><input id="dept" value="' + A.esc(p.department) + '"></div>' +
      '<div class="field"><label>专业</label><input id="major" value="' + A.esc(p.majorName) + '" list="majoropts"><datalist id="majoropts">' + majors.list.map((m) => '<option value="' + A.esc(m.name) + '">').join('') + '</datalist></div>' +
      '<div class="field"><label>学科门类</label><select id="disc"><option value="">未指定</option>' + Object.keys(tree).map((x) => '<option' + (p.discipline === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>入学年份</label><input id="year" type="number" value="' + p.enrollmentYear + '"></div>' +
      '<div class="field"><label>学制</label><select id="py">' + [2, 3, 4, 5].map((y) => '<option value="' + y + '"' + (Number(p.programYears) === y ? ' selected' : '') + '>' + y + ' 年</option>').join('') + '</select></div>' +
      '<div class="field"><label>当前学期</label><select id="term">' + A.TERMS.map((t) => '<option' + (p.term === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>性别（选填）</label><select id="gender">' + ['', '男', '女', '不愿透露'].map((g) => '<option value="' + g + '"' + (p.gender === g ? ' selected' : '') + '>' + (g || '不填') + '</option>').join('') + '</select></div>' +
      '</div><div class="row between mt12"><span class="muted small">推导年级：' + A.esc(p.grade || '—') + ' · ' + A.esc(p.educationLevel) + '</span><button class="btn primary" id="save">保存</button></div></div>');
    A.$('#save').onclick = async () => {
      try {
        A.loading(true, '正在保存…');
        await A.put('/api/profile', {
          school: A.$('#school').value, department: A.$('#dept').value, majorName: A.$('#major').value,
          discipline: A.$('#disc').value, enrollmentYear: Number(A.$('#year').value), programYears: Number(A.$('#py').value),
          term: A.$('#term').value, gender: A.$('#gender').value, schoolSource: '用户自填'
        });
        A.loading(false); A.toast('已保存', 'ok'); A.go('me');
      } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    };
  });

  /* ------------------------ 学习目标与时间 ------------------------ */
  A.register('me/goals', async () => {
    const g = await A.get('/api/goals');
    const t = await A.get('/api/time-constraint');
    const time = t.time || { daysPerWeek: 5, minutesPerDay: 60, restDays: [7] };
    A.render(A.backBar('我的') + A.head('学习目标与时间约束', '计划会按这里来排') +
      '<div class="card"><div class="card-title"><h3>目标</h3><button class="btn sm" id="addg">' + A.I.plus + '加一个</button></div>' +
      (g.list.length ? g.list.map((x) => '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(x.title) + '</div><div class="li-sub">' + A.esc(x.type) + (x.targetDate ? ' · 期望 ' + A.esc(x.targetDate) : '') + ' · 优先级 ' + A.esc(x.priority) + '</div></div><button class="btn sm ghost" data-dg="' + x.id + '">删除</button></div>').join('')
        : A.empty('还没有目标', '写一个最近想完成的事', '')) + '</div>' +
      '<div class="card"><div class="card-title"><h3>时间约束</h3></div>' +
      '<div class="grid two"><div class="field"><label>每周可学几天</label><input id="days" type="number" min="1" max="7" value="' + time.daysPerWeek + '"></div>' +
      '<div class="field"><label>每天大概多久（分钟）</label><input id="minutes" type="number" min="15" step="15" value="' + time.minutesPerDay + '"></div></div>' +
      '<div class="field"><label>固定休息日</label><div class="checks" id="rest">' + A.WEEK.map((w, i) => '<div class="check-pill' + ((time.restDays || []).includes(i + 1) ? ' on' : '') + '" data-d="' + (i + 1) + '">' + w + '</div>').join('') + '</div></div>' +
      '<div class="field"><label>时段偏好（选填）</label><input id="slots" value="' + A.esc(time.preferredSlots || '') + '"></div>' +
      '<div class="row between"><span class="muted small">休息日不排任务，也不会算落后</span><button class="btn primary" id="savet">保存</button></div></div>');
    let rest = (time.restDays || []).slice();
    A.$$('#rest .check-pill').forEach((b) => (b.onclick = () => { const d = Number(b.dataset.d); rest = rest.includes(d) ? rest.filter((x) => x !== d) : rest.concat(d); b.classList.toggle('on'); }));
    A.$('#savet').onclick = async () => {
      try {
        A.loading(true, '正在保存…');
        const r = await A.put('/api/time-constraint', { daysPerWeek: Number(A.$('#days').value), minutesPerDay: Number(A.$('#minutes').value), restDays: rest, preferredSlots: A.$('#slots').value });
        A.loading(false);
        if (r.timeChanged && r.activePlans.length) {
          A.confirmDialog('要重排计划吗？', '你有进行中的计划，改时间后可以把它重新排一遍。', async () => {
            await A.post('/api/plans/' + r.activePlans[0].id + '/reschedule', { reason: '时间约束变化' });
            A.toast('计划已重排', 'ok');
          }, '重排');
        } else A.toast('已保存', 'ok');
      } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    };
    if (A.$('#addg')) A.$('#addg').onclick = () => A.modal({
      title: '加一个目标', body: '<div class="field"><label>想完成什么</label><input id="gt"></div>' +
        '<div class="grid two"><div class="field"><label>类型</label><select id="gy">' + ['期末复习', '理解某门课程', '完成课程项目', '准备考试', '其他'].map((x) => '<option>' + x + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>期望时间（选填）</label><input id="gd" type="date"></div></div>',
      actions: [{ label: '取消' }, { label: '添加', kind: 'primary', onClick: async (w) => { try { await A.post('/api/goals', { title: A.$('#gt', w).value, type: A.$('#gy', w).value, targetDate: A.$('#gd', w).value }); A.toast('已添加', 'ok'); A.route(); } catch (e) { A.toast(e.message, 'err'); return false; } } }]
    });
    A.$$('[data-dg]').forEach((b) => (b.onclick = () => A.confirmDialog('删除这个目标？', '', async () => { await A.del('/api/goals/' + b.dataset.dg); A.route(); }, '删除')));
  });

  /* ---------------------- 院校与专业背景资料 ---------------------- */
  A.register('me/entity', async () => {
    const d = await A.get('/api/school-major-profile');
    const stateText = { pending: '待核对', verifying: '核对中', verified: '已核实', uncertain: '待核实', failed: '核对失败' };
    A.render(A.backBar('我的') + A.head('院校与专业资料', '自填的名称会在这里被核对与整理') +
      '<div class="card"><div class="card-title"><h3>自填内容</h3><button class="btn sm" id="add">' + A.I.plus + '添加</button></div>' +
      (d.list.length ? d.list.map((x) =>
        '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(x.raw) + ' <span class="muted small">' + (x.kind === 'school' ? '院校' : '专业') + '</span></div>' +
        '<div class="li-sub">' + (x.normalizedName ? '规范名称：' + A.esc(x.normalizedName) + ' · ' : '') + '状态：' + stateText[x.status] + (x.note ? ' · ' + A.esc(x.note) : '') + '</div>' +
        (x.items && x.items.length ? '<div class="mt8 small">' + x.items.map((i) => '<div class="row" style="gap:6px"><span>' + A.esc(i.text) + '</span>' + A.chip(i.confidence, i.confidence === '已核实' ? 'ok' : 'warn') + '</div>').join('') + '</div>' : '') +
        '</div><div class="col" style="gap:6px"><button class="btn sm ghost" data-rv="' + x.id + '">重新核对</button><button class="btn sm ghost" data-fb="' + x.id + '">内容有误</button></div></div>').join('')
        : A.empty('还没有自填的院校或专业', '库里找不到的，可以自己填一个', '')) + '</div>');
    if (A.$('#add')) A.$('#add').onclick = () => A.modal({
      title: '添加一项', body: '<div class="field"><label>类型</label><select id="k"><option value="school">院校</option><option value="major">专业</option></select></div>' +
        '<div class="field"><label>名称</label><input id="r" placeholder="填全称或你习惯的叫法"></div>',
      actions: [{ label: '取消' }, { label: '提交', kind: 'primary', onClick: async (w) => { try { await A.post('/api/school-major-profile', { kind: A.$('#k', w).value, raw: A.$('#r', w).value }); A.toast('已记录，正在后台核对', 'ok'); A.route(); } catch (e) { A.toast(e.message, 'err'); return false; } } }]
    });
    A.$$('[data-rv]').forEach((b) => (b.onclick = async () => { await A.post('/api/school-major-profile/' + b.dataset.rv + '/reverify'); A.toast('正在重新核对', 'ok'); A.route(); }));
    A.$$('[data-fb]').forEach((b) => (b.onclick = () => A.modal({
      title: '哪里不对？', body: '<div class="field"><textarea id="t" rows="3"></textarea></div>',
      actions: [{ label: '取消' }, { label: '提交', kind: 'primary', onClick: async (w) => { try { await A.post('/api/school-major-profile/' + b.dataset.fb + '/feedback', { text: A.$('#t', w).value }); A.toast('已收到，会重新核对', 'ok'); A.route(); } catch (e) { A.toast(e.message, 'err'); return false; } } }]
    })));
  });

  /* ------------------------- 我的学习情况 ------------------------- */
  A.register('me/selfreport', async () => {
    const d = await A.get('/api/self-report');
    const statusText = { empty: '未填写', pending: '待提炼', extracting: '提炼中', done: '已提炼', failed: '提炼失败', skipped: '已跳过' };
    A.render(A.backBar('我的') + A.head('我的学习情况', '写清楚学过什么，讲题时就不会从零讲起', A.chip(statusText[d.status] || '')) +
      '<div class="card"><div class="field"><label>你的学习情况</label><textarea id="raw" rows="7" placeholder="学过的课、在学的内容、做过的项目">' + A.esc(d.rawText) + '</textarea>' +
      '<div class="tip">最多 ' + d.maxLen + ' 字，可跳过</div></div>' +
      '<div class="row between"><button class="btn ghost" id="skip">跳过</button><button class="btn primary" id="save">保存并提炼</button></div></div>' +
      '<div class="card"><div class="card-title"><h3>AI 理解的</h3><div class="row"><button class="btn sm ghost" id="re">重新提炼</button><button class="btn sm danger-ghost" id="clear">清除全部</button></div></div>' +
      (d.items.length ? d.items.map((i) =>
        '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(i.content) + (i.adopted === false ? ' <span class="muted small">（已否定）</span>' : '') + '</div>' +
        '<div class="li-sub">' + A.esc(i.itemType) + (i.sourceType === 'subjective' ? ' · <span class="chip warn">学生自述，非能力判定</span>' : ' · 客观陈述') + (i.sourceSpan ? ' · 来自原文：' + A.esc(i.sourceSpan.slice(0, 30)) : '') + '</div></div>' +
        '<div class="row" style="gap:6px"><button class="btn sm ghost" data-ed="' + i.id + '">改</button><button class="btn sm ghost" data-tg="' + i.id + '" data-v="' + (i.adopted === false ? '1' : '0') + '">' + (i.adopted === false ? '恢复' : '否定') + '</button><button class="btn sm ghost" data-dl="' + i.id + '">删</button></div></div>').join('')
        : A.empty('还没有提炼结果', '写完保存，我会在后台整理', '')) + '</div>');
    A.$('#save').onclick = async () => {
      try { A.loading(true, '正在保存…'); await A.post('/api/self-report', { rawText: A.$('#raw').value }); A.loading(false); A.toast('已保存，正在后台提炼', 'ok'); setTimeout(A.route, 1200); }
      catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    };
    A.$('#skip').onclick = async () => { await A.post('/api/self-report', { skip: true }); A.toast('已跳过', 'ok'); A.go('me'); };
    A.$('#re').onclick = async () => { await A.post('/api/self-report/re-extract'); A.toast('正在重新提炼', 'ok'); setTimeout(A.route, 1200); };
    A.$('#clear').onclick = () => A.confirmDialog('清除全部内容？', '原文与提炼结果都会删除，其他功能的贴合度会下降。', async () => { await A.del('/api/self-report'); A.toast('已清除', 'ok'); A.route(); }, '清除');
    A.$$('[data-dl]').forEach((b) => (b.onclick = async () => { await A.del('/api/self-report/items/' + b.dataset.dl); A.route(); }));
    A.$$('[data-tg]').forEach((b) => (b.onclick = async () => { await A.patch('/api/self-report/items/' + b.dataset.tg, { adopted: b.dataset.v === '0' ? false : true }); A.route(); }));
    A.$$('[data-ed]').forEach((b) => (b.onclick = () => {
      const item = d.items.find((x) => x.id === b.dataset.ed);
      A.modal({
        title: '修改这条', body: '<div class="field"><textarea id="c" rows="3">' + A.esc(item.content) + '</textarea></div>',
        actions: [{ label: '取消' }, { label: '保存', kind: 'primary', onClick: async (w) => { await A.patch('/api/self-report/items/' + item.id, { content: A.$('#c', w).value }); A.toast('已保存', 'ok'); A.route(); } }]
      });
    }));
  });

  /* ------------------------ 学习资料分析 ------------------------ */
  A.register('docs', async (args) => {
    if (args && args[0]) return docDetail(args[0]);
    const d = await A.get('/api/documents');
    const plan = await A.get('/api/plans');
    const statusText = { pending: '排队中', parsing: '分析中', done: '已解析', failed: '解析失败' };
    A.render(A.head('学习资料分析', '上传 PDF / TXT / DOCX / MD，我会整理成学习地图') +
      '<div class="card"><div class="card-title"><h3>上传资料</h3></div>' +
      '<div class="drop" id="drop">点击或拖入文件（PDF / TXT / DOCX / MD）</div><input type="file" id="file" class="hidden" accept=".pdf,.txt,.md,.docx">' +
      '<div class="inline-loading mt12 hidden" id="up"><div class="spinner"></div>正在上传与解析…</div></div>' +
      '<div class="section-title">我的资料</div>' +
      (d.list.length ? '<div class="card">' + d.list.map((x) =>
        '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(x.title) + '</div>' +
        '<div class="li-sub">' + A.esc(x.ext.toUpperCase()) + ' · ' + Math.round((x.bytes || 0) / 1024) + 'KB · ' + A.fmtDateTime(x.createdAt) +
        (x.parseStatus === 'done' ? ' · ' + (x.chapterCount || 0) + ' 节 / ' + (x.knowledgeCount || 0) + ' 个知识点' : '') +
        (x.failReason ? ' · ' + A.esc(x.failReason) + '（' + A.esc(x.failDetail || '') + '）' : '') + '</div></div>' +
        A.statusChip(statusText[x.parseStatus]) +
        '<div class="col" style="gap:6px"><a class="btn sm" href="#/docs/' + x.id + '">查看</a><button class="btn sm ghost" data-dl="' + x.id + '">原文件</button></div></div>').join('') + '</div>'
        : A.empty('还没有上传资料', '上传后就能生成学习计划和难点提示', '')) +
      '<div class="section-title">我的计划</div>' +
      (plan.list.length ? '<div class="card">' + plan.list.map((p) =>
        '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(p.title) + '</div>' +
        '<div class="li-sub">' + A.esc(p.status) + ' · ' + p.done + '/' + p.total + ' 项完成' + (p.deadline ? ' · 期望 ' + A.esc(p.deadline) : '') + '</div></div>' +
        '<a class="btn sm" href="#/me/plan/' + p.id + '">打开</a></div>').join('') + '</div>'
        : A.empty('还没有计划', '打开一份资料，点「制定学习计划」', '')));

    A.$('#drop').onclick = () => A.$('#file').click();
    A.$('#drop').ondragover = (e) => e.preventDefault();
    A.$('#drop').ondrop = (e) => { e.preventDefault(); upload(e.dataTransfer.files[0]); };
    A.$('#file').onchange = (e) => upload(e.target.files[0]);
    async function upload(file) {
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      A.$('#up').classList.remove('hidden');
      try {
        const r = await A.post('/api/documents', fd);
        A.$('#up').classList.add('hidden');
        if (r.document.parseStatus === 'failed') A.toast(r.document.failReason + '：' + (r.document.failDetail || ''), 'err');
        else A.toast('已上传，正在分析', 'ok');
        A.route();
      } catch (e) { A.$('#up').classList.add('hidden'); A.toast(e.message, 'err'); }
    }
    A.$$('[data-dl]').forEach((b) => (b.onclick = () => window.open('/api/documents/' + b.dataset.dl + '/file', '_blank')));
  });

  async function docDetail(id) {
    const d = await A.get('/api/documents/' + id);
    const doc = d.document;
    if (doc.parseStatus !== 'done') {
      A.render(A.backBar('资料') + A.head(doc.title, '正在分析') +
        '<div class="card">' + (doc.parseStatus === 'failed'
          ? '<p>' + A.esc(doc.failReason || '解析失败') + '</p><p class="muted small">' + A.esc(doc.failDetail || '') + '</p><button class="btn mt12" id="re">重新解析</button>'
          : '<div class="inline-loading"><div class="spinner"></div>' + A.esc(doc.progressNote || '分析中…') + '</div><button class="btn mt16" id="refresh">刷新</button>') + '</div>');
      if (A.$('#re')) A.$('#re').onclick = async () => { await A.post('/api/documents/' + id + '/analyze'); A.toast('已重新开始', 'ok'); setTimeout(() => docDetail(id), 1200); };
      if (A.$('#refresh')) A.$('#refresh').onclick = () => docDetail(id);
      return;
    }
    const planForm = '<div class="card"><div class="card-title"><h3>制定学习计划</h3></div>' +
      '<div class="field"><label>这次的目标</label><input id="goal" value="学完《' + A.esc(doc.title) + '》"></div>' +
      '<div class="grid two"><div class="field"><label>期望完成时间（选填）</label><input id="deadline" type="date"></div>' +
      '<div class="field"><label>每天大概多久（分钟）</label><input id="minutes" type="number" min="15" step="15" value="60"></div></div>' +
      '<div class="field"><label>固定休息日</label><div class="checks" id="rest">' + A.WEEK.map((w, i) => '<div class="check-pill" data-d="' + (i + 1) + '">' + w + '</div>').join('') + '</div>' +
      '</div>' +
      '<button class="btn primary block" id="mk">生成计划</button></div>';

    A.render(A.backBar('学习资料') + A.head(doc.title, (doc.overview || '') + (d.truncated ? '（内容较长，先分析了主要部分）' : '')) +
      '<div class="grid two">' +
      '<div class="card"><div class="card-title"><h3>章节结构</h3><span class="muted small">' + d.chapters.length + ' 节</span></div>' +
      (d.chapters.length ? d.chapters.map((c) => '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(c.orderNo + '. ' + c.title) + '</div>' +
        (c.summary ? '<div class="li-sub">' + A.esc(c.summary) + '</div>' : '') +
        ((c.concepts || []).length ? '<div class="chips mt8">' + c.concepts.slice(0, 6).map((x) => A.chip(x)).join('') + '</div>' : '') + '</div></div>').join('')
        : A.empty('没有识别到章节', '', '')) + '</div>' +
      '<div class="card"><div class="card-title"><h3>难点提示</h3><span class="muted small">' + d.marks.length + ' 处</span></div>' +
      (d.marks.length ? d.marks.map((m) => '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(m.chapter || '—') + ' ' + A.chip(m.level, m.level === '重点难点' ? 'warn' : '') + (m.source === '学生修正' ? A.chip('已按你的反馈修改', 'ok') : '') + '</div>' +
        '<div class="li-sub">' + A.esc(m.reason) + ((m.missingPrerequisites || []).length ? ' · 缺少前置：' + A.esc(m.missingPrerequisites.join('、')) : '') + '</div></div>' +
        '<div class="row" style="gap:6px"><button class="btn sm ghost" data-wrong="' + m.id + '">标错了</button><button class="btn sm ghost" data-miss="' + m.id + '">标漏了</button></div></div>').join('')
        : A.empty('还没有难点标注', '', '')) +
      '<p class="muted tiny mt8">这是根据内容本身与前置知识判断的，不是对你的能力评价。</p></div>' +
      '</div>' +
      '<div class="card"><div class="card-title"><h3>知识点与自测</h3><span class="muted small">' + d.knowledge.length + ' 个</span></div>' +
      '<div class="chips mb12">' + d.knowledge.slice(0, 40).map((k) => A.chip(k.name + ' · ' + k.difficulty)).join('') + '</div>' +
      (d.questions.length ? d.questions.map((q) => '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(q.knowledgePoint) + ' <span class="muted small">' + A.esc(q.questionType) + '</span></div>' +
        '<div class="li-sub">' + A.esc(q.questionText) + '</div><div class="mt8 hidden" data-ans="' + q.id + '"></div></div>' +
        '<div class="col" style="gap:6px"><button class="btn sm" data-show="' + q.id + '" data-kp="' + A.esc(q.knowledgePoint) + '">对答案</button><button class="btn sm ghost" data-more="' + A.esc(q.knowledgePoint) + '">再来一题</button></div></div>').join('')
        : '<p class="muted small">这份资料还没有生成自测题。</p>') + '</div>' +
      planForm + (d.plans.length ? '<p class="muted small mt12">这份资料已有 ' + d.plans.length + ' 个计划：' + d.plans.map((p) => '<a href="#/me/plan/' + p.id + '">' + A.esc(p.title) + '</a>').join('、') + '</p>' : ''));

    let rest = [];
    A.$$('#rest .check-pill').forEach((b) => (b.onclick = () => { const x = Number(b.dataset.d); rest = rest.includes(x) ? rest.filter((y) => y !== x) : rest.concat(x); b.classList.toggle('on'); }));
    A.$$('[data-wrong]').forEach((b) => (b.onclick = async () => { await A.post('/api/documents/' + id + '/difficulty/' + b.dataset.wrong + '/feedback', { type: 'wrong' }); A.toast('已记录，会以你的判断为准', 'ok'); docDetail(id); }));
    A.$$('[data-miss]').forEach((b) => (b.onclick = async () => { await A.post('/api/documents/' + id + '/difficulty/' + b.dataset.miss + '/feedback', { type: 'missed' }); A.toast('已记录', 'ok'); docDetail(id); }));
    A.$$('[data-show]').forEach((b) => (b.onclick = async () => {
      const r = await A.get('/api/diagnostic/' + b.dataset.show);
      const box = A.$('[data-ans="' + b.dataset.show + '"]');
      box.classList.remove('hidden');
      box.innerHTML = '<div class="answer-block"><b class="small muted">答案</b><div>' + A.esc(r.answer) + '</div>' + (r.explanation ? '<div class="muted small mt8">' + A.esc(r.explanation) + '</div>' : '') + '</div>' +
        '<div class="row mt8"><button class="btn sm" data-rec="正确">做对了</button><button class="btn sm" data-rec="部分正确">一半一半</button><button class="btn sm" data-rec="错误">做错了</button></div>';
      A.$$('[data-rec]', box).forEach((rb) => (rb.onclick = async () => {
        await A.post('/api/records', { topicName: b.dataset.kp, recordType: '自测', result: rb.dataset.rec, source: '自测题' });
        A.toast('已记下', 'ok');
      }));
    }));
    A.$$('[data-more]').forEach((b) => (b.onclick = async () => {
      try { A.loading(true, '正在出题…'); const r = await A.post('/api/diagnostic', { knowledgePoint: b.dataset.more, documentId: id }); A.loading(false); if (!r.ok) { A.toast(r.error, 'err'); return; } A.toast('新题已生成，刷新查看', 'ok'); docDetail(id); }
      catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    }));
    A.$('#mk').onclick = async () => {
      try {
        A.loading(true, '正在生成计划…');
        const r = await A.post('/api/plans', { documentId: id, goal: A.$('#goal').value, deadline: A.$('#deadline').value, minutesPerDay: Number(A.$('#minutes').value), restDays: rest });
        A.loading(false);
        A.toast(r.degraded ? '计划已生成（本次按章节先排）' : '计划已生成', 'ok');
        A.go('me/plan/' + r.plan.id);
      } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    };
  }

  // 旧地址兼容：#/me/docs 已提升为一级页面 #/docs
  A.register('me/docs', async (args) => { A.go(args && args[0] ? 'docs/' + args[0] : 'docs'); });

  /* ---------------------------- 计划详情 ---------------------------- */
  A.register('me/plan', async (args) => {
    const id = args[0];
    const d = await A.get('/api/plans/' + id);
    const p = d.plan;
    A.render(A.backBar('计划') + A.head(p.title, (p.deadline ? '期望 ' + p.deadline + ' 完成 · ' : '') + '每天 ' + p.minutesPerDay + ' 分钟') +
      '<div class="row wrap mb12"><button class="btn sm" id="re">重排后面的安排</button><button class="btn sm" id="ex">导出计划</button>' +
      (p.status === '进行中' ? '<button class="btn sm ghost" id="end">结束计划</button>' : A.chip(p.status, 'ok')) + '</div>' +
      (d.adjustments.length ? '<div class="card pad-sm mb12"><b class="small">最近的调整</b><div class="muted small mt8">' + d.adjustments.map((a) => A.fmtDateTime(a.createdAt) + '：' + A.esc(a.note || a.trigger)).join('<br>') + '</div></div>' : '') +
      d.days.map((day) =>
        '<div class="card"><div class="card-title"><h3>' + A.esc(day.date) + ' ' + A.esc(A.WEEK[(new Date(day.date + 'T00:00:00').getDay() + 6) % 7]) + '</h3><span class="muted small">' + day.totalMinutes + ' 分钟</span></div>' +
        day.tasks.map((t) => '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(t.title) + '</div>' +
          '<div class="li-sub">' + t.estimatedMinutes + ' 分钟 · ' + A.esc(t.actionType) + (t.chapter ? ' · ' + A.esc(t.chapter) : '') + '</div>' +
          '<div class="li-sub">完成标准：' + A.esc(t.completionCriteria) + '</div></div>' + A.statusChip(t.status) +
          '<button class="btn sm ghost" data-ed="' + t.id + '">调整</button></div>').join('') + '</div>').join(''));

    A.$('#re').onclick = async () => {
      try { A.loading(true, '正在重排…'); const r = await A.post('/api/plans/' + id + '/reschedule', { reason: '手动重排' }); A.loading(false); A.toast(r.note || '已重排', 'ok'); A.route(); }
      catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    };
    A.$('#ex').onclick = () => window.open('/api/plans/' + id + '/export', '_blank');
    if (A.$('#end')) A.$('#end').onclick = () => A.confirmDialog('结束这个计划？', '结束后不再生成新任务，原有记录会保留。', async () => { await A.patch('/api/plans/' + id, { status: '已结束' }); A.toast('已结束', 'ok'); A.go('docs'); }, '结束');
    A.$$('[data-ed]').forEach((b) => (b.onclick = async () => {
      const t = d.days.flatMap((x) => x.tasks).find((x) => x.id === b.dataset.ed);
      A.modal({
        title: '调整这件任务', body: '<div class="field"><label>标题</label><input id="t" value="' + A.esc(t.title) + '"></div>' +
          '<div class="grid two"><div class="field"><label>日期</label><input id="d" type="date" value="' + t.plannedDate + '"></div>' +
          '<div class="field"><label>预计分钟</label><input id="m" type="number" value="' + t.estimatedMinutes + '"></div></div>' +
          '<div class="field"><label>优先级</label><select id="pr">' + ['高', '中', '低'].map((x) => '<option' + (t.priority === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>',
        actions: [{ label: '取消' }, {
          label: '保存', kind: 'primary', onClick: async (w) => {
            await A.patch('/api/tasks/' + t.id + '/edit', { title: A.$('#t', w).value, plannedDate: A.$('#d', w).value, estimatedMinutes: Number(A.$('#m', w).value), priority: A.$('#pr', w).value });
            A.toast('已保存', 'ok'); A.route();
          }
        }]
      });
    }));
  });

  /* ---------------------------- 成长记录 ---------------------------- */
  A.register('me/growth', async () => {
    const st = await A.get('/api/knowledge-states');
    const rec = await A.get('/api/records?limit=40');
    A.render(A.backBar('我的') + A.head('成长记录', '记录来自你的练习与反馈', '<button class="btn sm" id="sum">看总结</button>') +
      '<div class="card"><div class="card-title"><h3>知识点状态</h3><span class="muted small">' + st.list.length + ' 个</span></div>' +
      (st.list.length ? st.list.map((s) => '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(s.topicName) + ' ' + A.statusChip(s.state) + '</div>' +
        '<div class="li-sub">' + s.recordCount + ' 条记录 · 最近 ' + A.fmtDateTime(s.updatedAt || s.createdAt) + (s.state === '需复习' ? ' · 可以安排一次复习' : '') + '</div></div>' +
        '<button class="btn sm ghost" data-cl="' + s.id + '">清除</button></div>').join('')
        : A.empty('还没有知识点状态', '做完任务或自测后会自动出现', '')) +
      '<p class="muted tiny mt8">' + A.esc(st.notice) + '</p></div>' +
      '<div class="card" id="summaryBox"></div>' +
      '<div class="card"><div class="card-title"><h3>学习记录</h3><span class="muted small">共 ' + rec.total + ' 条</span></div>' +
      (rec.list.length ? rec.list.map((r) => '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(r.topicName) + ' · ' + A.esc(r.recordType) + ' · ' + A.esc(r.result) + '</div>' +
        '<div class="li-sub">' + A.fmtDateTime(r.createdAt) + (r.wrongReason ? ' · 原因：' + A.esc(r.wrongReason) : '') + (r.feedback ? ' · ' + A.esc(r.feedback) : '') + '</div></div>' +
        '<button class="btn sm ghost" data-dl="' + r.id + '">删除</button></div>').join('')
        : A.empty('还没有记录', '完成任务或在搜题页反馈后会出现', '')) + '</div>');
    A.$$('[data-cl]').forEach((b) => (b.onclick = async () => { await A.patch('/api/knowledge-states/' + b.dataset.cl, { clear: true }); A.toast('已清除', 'ok'); A.route(); }));
    A.$$('[data-dl]').forEach((b) => (b.onclick = async () => { await A.del('/api/records/' + b.dataset.dl); A.route(); }));
    A.$('#sum').onclick = async () => {
      try {
        A.loading(true, '正在整理…');
        const r = await A.post('/api/records/summary', {});
        A.loading(false);
        A.$('#summaryBox').innerHTML = r.ok
          ? '<div class="card-title"><h3>近期小结</h3></div><p>' + A.esc(r.summary) + '</p>' + (r.points || []).map((p) => '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(p.topic) + ' ' + A.statusChip(p.state) + '</div><div class="li-sub">' + A.esc(p.suggestion) + '</div></div></div>').join('')
          : '<p class="muted">' + A.esc(r.error || '暂时生成不出来') + '</p>';
      } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    };
  });

  /* ---------------------------- 资源库 ---------------------------- */
  A.register('me/library', async () => {
    let sort = 'added';
    async function draw() {
      const d = await A.get('/api/bookmarks?sort=' + sort);
      A.render(A.backBar('我的') + A.head('我的资源库', d.total + ' 条收藏 · 上限 ' + d.limit) +
        '<div class="segmented mb12" id="sort">' + [['added', '按加入时间'], ['recent', '按最近打开'], ['topic', '按主题']].map(([k, l]) => '<button data-s="' + k + '" class="' + (sort === k ? 'active' : '') + '">' + l + '</button>').join('') + '</div>' +
        (d.list.length ? '<div class="cards-grid">' + d.list.map((b) =>
          '<div class="rcard"><div class="row between"><div class="r-title">' + A.esc(b.title) + '</div>' + A.chip(b.type) + '</div>' +
          '<div class="r-intro">' + A.esc(b.intro || '') + '</div>' +
          '<div class="chips">' + A.chip(b.platformName || '') + A.chip(b.access || '') + (b.topic ? A.chip(b.topic) : '') + (b.linkStatus && b.linkStatus !== '可用' ? A.chip(b.linkStatus, 'warn') : '') + '</div>' +
          '<div class="tiny muted">加入于 ' + A.fmtDate(b.addedAt) + (b.lastOpenedAt ? ' · 最近打开 ' + A.fmtDateTime(b.lastOpenedAt) : '') + '</div>' +
          ((b.tags || []).length ? '<div class="chips">' + b.tags.map((t) => A.chip(t, 'plain')).join('') + '</div>' : '') +
          '<div class="row wrap mt8"><button class="btn sm" data-open="' + b.id + '">打开原站</button><button class="btn sm ghost" data-tag="' + b.bookmarkId + '">标签</button><button class="btn sm ghost" data-report="' + b.id + '">失效反馈</button><button class="btn sm danger-ghost" data-rm="' + b.bookmarkId + '">移除</button></div></div>').join('') + '</div>'
          : A.empty('资源库还是空的', '在学习资源推送里点「收藏」，就会出现在这里', '<a class="btn primary sm" href="#/resources">去找资源</a>')) +
        '<div class="row mt16"><button class="btn sm ghost" id="verify">检查链接是否可用</button></div>');
      A.$$('#sort button').forEach((b) => (b.onclick = () => { sort = b.dataset.s; draw(); }));
      A.$$('[data-open]').forEach((b) => (b.onclick = async () => { const r = await A.post('/api/resources/' + b.dataset.open + '/open'); A.confirmDialog('即将离开本平台', '资源在原始网站打开。', () => window.open(r.url, '_blank', 'noopener')); }));
      A.$$('[data-rm]').forEach((b) => (b.onclick = () => A.confirmDialog('移除这条收藏？', '移除不影响原始网站上的资源。', async () => { await A.del('/api/bookmarks/' + b.dataset.rm); A.toast('已移除', 'ok'); draw(); }, '移除')));
      A.$$('[data-report]').forEach((b) => (b.onclick = async () => { await A.post('/api/resources/' + b.dataset.report + '/report', { type: 'broken' }); A.toast('已标记失效', 'ok'); draw(); }));
      A.$$('[data-tag]').forEach((b) => (b.onclick = () => A.modal({
        title: '加标签', body: '<div class="field"><label>标签（逗号分隔，最多 6 个）</label><input id="tg"></div>',
        actions: [{ label: '取消' }, { label: '保存', kind: 'primary', onClick: async (w) => { await A.patch('/api/bookmarks/' + b.dataset.tag, { tags: A.$('#tg', w).value.split(/[,，]/).map((x) => x.trim()).filter(Boolean) }); A.toast('已保存', 'ok'); draw(); } }]
      })));
      A.$('#verify').onclick = async () => { A.toast('正在检查，稍后刷新查看', 'ok'); await A.post('/api/resources/verify'); setTimeout(draw, 4000); };
    }
    await draw();
  });

  /* -------------------------- 每日建议记录 -------------------------- */
  A.register('me/suggestions', async () => {
    const d = await A.get('/api/suggestions/history');
    const label = { done: '已经学了', rest: '今天休息', notinterested: '不想学这个' };
    A.render(A.backBar('我的') + A.head('每日建议记录', '这里是过去的建议和你的回应') +
      (d.list.length ? '<div class="card">' + d.list.map((s) =>
        '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(s.date) + ' · ' + A.esc(s.content) + '</div>' +
        '<div class="li-sub">' + A.esc(s.reason || '') + (s.feedback ? ' · 你的回应：' + label[s.feedback] : ' · 未回应') + '</div></div>' +
        (s.feedback ? '<button class="btn sm ghost" data-u="' + s.id + '">撤回</button>' : A.statusChip(s.status)) + '</div>').join('') + '</div>'
        : A.empty('还没有记录', '首页每天会有一条建议', '')));
    A.$$('[data-u]').forEach((b) => (b.onclick = async () => { await A.del('/api/suggestions/' + b.dataset.u + '/feedback'); A.toast('已撤回', 'ok'); A.route(); }));
  });

  /* --------------------------- 数据与隐私 --------------------------- */
  A.register('me/privacy', async () => {
    const d = await A.get('/api/privacy/data-map');
    A.render(A.backBar('我的') + A.head('数据与隐私', '这里说明平台记录了什么、用来做什么') +
      '<div class="card"><p class="muted small">' + A.esc(d.notice) + '</p></div>' +
      '<div class="card">' + d.categories.map((c) =>
        '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(c.name) + ' <span class="muted small">' + c.count + ' 条</span></div>' +
        '<div class="li-sub">记录：' + A.esc(c.what) + '</div><div class="li-sub">用途：' + A.esc(c.purpose) + '</div></div>' +
        (c.deletable ? '<button class="btn sm ghost" data-p="' + c.key + '">清除</button>' : A.chip('不可清除', 'plain')) + '</div>').join('') + '</div>' +
      '<div class="row wrap"><button class="btn" id="exp">导出我的数据（JSON）</button><button class="btn danger-ghost" id="all">清除我的全部数据</button></div>' +
      '<p class="muted tiny mt12">清除全部数据会保留你的账号与基本信息，其余内容删除后相关功能会少一些参考，但都能继续使用。</p>');
    A.$$('[data-p]').forEach((b) => (b.onclick = () => {
      const c = d.categories.find((x) => x.key === b.dataset.p);
      A.confirmDialog('清除「' + c.name + '」？', '清除后不可恢复。', async () => { await A.post('/api/privacy/purge', { scope: c.key }); A.toast('已清除', 'ok'); A.route(); }, '清除');
    }));
    A.$('#exp').onclick = () => window.open('/api/privacy/export', '_blank');
    A.$('#all').onclick = () => A.confirmDialog('清除全部数据？', '账号与基本信息保留，其余记录会删除。', async () => { await A.post('/api/privacy/purge', { scope: 'all' }); A.toast('已清除', 'ok'); A.go('me'); }, '清除全部');
  });
})();
