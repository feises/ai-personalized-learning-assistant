'use strict';
/* 页面：登录 / 首次填写 / 今日 / AI 搜题 */
(function () {
  const A = App;

  /* ============================== 登录 ============================== */
  A.register('login', async () => {
    let mode = 'login';
    function draw() {
      A.$$('#sidebar, #bottomnav').forEach((e) => (e.innerHTML = ''));
      const appEl = document.getElementById('app');
      if (appEl) appEl.style.display = 'none';
      let w = document.getElementById('authwrap');
      if (!w) {
        document.body.insertAdjacentHTML('beforeend', '<div class="auth-wrap" id="authwrap"></div>');
        w = document.getElementById('authwrap');
      }
      w.innerHTML =
        '<div class="auth-card"><div class="logo">学</div><h1 style="font-size:19px">“学伴AI”大学生个性化学习助手</h1>' +
        '<p class="muted small mt8 mb16">上传资料、安排计划、随时提问，学得清楚一点。</p>' +
        '<div class="segmented mb16" style="width:100%"><button class="' + (mode === 'login' ? 'active' : '') + '" data-m="login" style="flex:1">登录</button><button class="' + (mode === 'register' ? 'active' : '') + '" data-m="register" style="flex:1">注册</button></div>' +
        '<div class="field"><label>用户名</label><input id="u" autocomplete="username"></div>' +
        '<div class="field"><label>密码</label><div class="pw-wrap"><input id="p" type="password" autocomplete="current-password">' +
        '<button type="button" class="pw-toggle" id="pwToggle" aria-label="显示密码" title="显示密码" aria-controls="p">' + A.I.eye + '</button></div></div>' +
        (mode === 'register' ? '<div class="field"><label>昵称（可空）</label><input id="n"></div>' : '') +
        '<button class="btn primary block mt8" id="go">' + (mode === 'login' ? '登录' : '注册并开始') + '</button>' +
        '</div>';
      A.$$('[data-m]', w).forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); }));
      // 密码显示 / 隐藏切换
      const pwd = A.$('#p', w);
      const toggle = A.$('#pwToggle', w);
      toggle.onclick = () => {
        const show = pwd.type === 'password';
        pwd.type = show ? 'text' : 'password';
        toggle.innerHTML = show ? A.I.eyeOff : A.I.eye;
        toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
        toggle.title = show ? '隐藏密码' : '显示密码';
        pwd.focus();
      };
      const submit = async () => {
        const username = A.$('#u').value.trim(), password = A.$('#p').value;
        if (!username || !password) return A.toast('请填写用户名和密码', 'err');
        try {
          A.loading(true, mode === 'login' ? '正在登录…' : '正在创建账号…');
          const r = await A.post('/api/auth/' + (mode === 'login' ? 'login' : 'register'), { username, password, nickname: mode === 'register' ? A.$('#n').value.trim() : undefined });
          A.loading(false);
          A.state.user = r.user;
          await A.refreshMe();
          document.getElementById('authwrap').remove();
          location.reload();
        } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
      };
      A.$('#go', w).onclick = submit;
      w.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (!e.target || e.target.tagName !== 'BUTTON')) submit(); });
    }
    draw();
  });

  /* ============================ 首次填写 ============================ */
  A.register('onboarding', async () => {
    await A.refreshMe();
    if (A.state.me && A.state.me.flags.hasProfile) { location.hash = '#/today'; return; }
    const draft = { school: '', schoolSource: '用户自填', majorName: '', majorCode: '', discipline: '', majorCategory: '', enrollmentYear: new Date().getFullYear() - 1, programYears: 4, term: '大二上', department: '', gender: '', goal: '', targetDate: '', daysPerWeek: 5, minutesPerDay: 60, restDays: [7], selfText: '' };
    let step = 1;
    const TOTAL = 5;

    async function renderStep() {
      const stepper = '<div class="stepper">' + Array.from({ length: TOTAL }, (_, i) => '<div class="s' + (i < step ? ' on' : '') + '"></div>').join('') + '</div>';
      let body = '';
      if (step === 1) {
        body = '<h2 style="font-size:18px">你所在的院校</h2><p class="muted small mt8">填了它，后面的资料和讲解更贴合你的课程。</p>' +
          '<div class="field mt16"><label>院校</label><input id="school" placeholder="输入院校名称" value="' + A.esc(draft.school) + '">' +
          '<div class="tip">找不到就自己填全称。</div><div id="schoolList" class="chips mt8"></div></div>';
      } else if (step === 2) {
        body = '<h2 style="font-size:18px">你的专业</h2>' +
          '<div class="field mt16"><label>搜索专业</label><input id="majorQ" value=""></div>' +
          '<div class="field"><label>学科门类</label><select id="disc"></select></div>' +
          '<div class="field"><label>专业类</label><select id="cat"></select></div>' +
          '<div class="field"><label>专业</label><select id="maj"></select></div>' +
          '<div id="picked" class="chip brand">' + (draft.majorName ? A.esc(draft.majorName) : '尚未选择') + '</div>';
      } else if (step === 3) {
        body = '<h2 style="font-size:18px">学期信息</h2><p class="muted small mt8">用入学年份和当前学期来推导年级，开学后不用手动改。</p>' +
          '<div class="grid two mt16">' +
          '<div class="field"><label>入学年份</label><input id="year" type="number" min="2000" max="' + new Date().getFullYear() + '" value="' + draft.enrollmentYear + '"></div>' +
          '<div class="field"><label>学制</label><select id="py"><option value="3">3 年</option><option value="4">4 年</option><option value="5">5 年</option><option value="2">2 年</option></select></div>' +
          '<div class="field"><label>当前学期</label><select id="term"></select></div>' +
          '<div class="field"><label>学院 / 系别（选填）</label><input id="dept" value="' + A.esc(draft.department) + '"></div></div>' +
          '<div class="field"><label>性别（选填）</label><div class="checks" id="gender">' + ['男', '女', '不愿透露'].map((g) => '<div class="check-pill' + (draft.gender === g ? ' on' : '') + '" data-g="' + g + '">' + g + '</div>').join('') + '</div><div class="tip">不参与任何评价</div></div>';
      } else if (step === 4) {
        body = '<h2 style="font-size:18px">你的目标和时间</h2><p class="muted small mt8">计划会按这个来排。</p>' +
          '<div class="field mt16"><label>最近想完成的事</label><input id="goal" value="' + A.esc(draft.goal) + '">' +
          '</div>' +
          '<div class="field"><label>期望完成时间（选填）</label><input id="targetDate" type="date" value="' + A.esc(draft.targetDate) + '"></div>' +
          '<div class="grid two"><div class="field"><label>每周可学几天</label><input id="days" type="number" min="1" max="7" value="' + draft.daysPerWeek + '"></div>' +
          '<div class="field"><label>每天大概多久（分钟）</label><input id="minutes" type="number" min="15" step="15" value="' + draft.minutesPerDay + '"></div></div>' +
          '<div class="field"><label>固定休息日</label><div class="checks" id="rest">' + A.WEEK.map((w, i) => '<div class="check-pill' + (draft.restDays.includes(i + 1) ? ' on' : '') + '" data-d="' + (i + 1) + '">' + w + '</div>').join('') + '</div></div>';
      } else {
        body = '<h2 style="font-size:18px">说说你的学习情况</h2><p class="muted small mt8">写清楚你学过什么，讲题时就不会从零讲起。</p>' +
          '<div class="field mt16"><textarea id="self" rows="7" placeholder="学过的课、在学的内容、做过的项目">' + A.esc(draft.selfText) + '</textarea>' +
          '</div>';
      }
      A.render('<div class="card" style="max-width:640px;margin:24px auto">' + stepper + body +
        '<div class="row between mt16"><button class="btn ghost" id="back">' + (step === 1 ? '稍后填写' : (step === TOTAL ? '跳过' : '上一步')) + '</button>' +
        '<button class="btn primary" id="next">' + (step === TOTAL ? '完成' : '下一步') + '</button></div>' +
        '<p class="muted tiny mt12">填写内容仅用于给你本人安排学习。</p></div>');

      if (step === 1) {
        const input = A.$('#school');
        const list = A.$('#schoolList');
        let t = null;
        const search = async () => {
          try {
            const r = await A.get('/api/presets/schools?q=' + encodeURIComponent(input.value.trim()));
            list.innerHTML = r.list.slice(0, 8).map((s) => '<div class="check-pill" data-s="' + A.esc(s.name) + '">' + A.esc(s.name) + '<span class="muted tiny"> · ' + A.esc(s.province) + '</span></div>').join('');
            A.$$('[data-s]', list).forEach((b) => (b.onclick = () => { draft.school = b.dataset.s; draft.schoolSource = '库内匹配'; input.value = b.dataset.s; A.toast('已选择：' + b.dataset.s, 'ok'); }));
          } catch (e) {}
        };
        input.oninput = () => { clearTimeout(t); t = setTimeout(search, 220); };
        input.onblur = () => { if (input.value.trim()) { draft.school = input.value.trim(); if (draft.schoolSource !== '库内匹配') draft.schoolSource = '用户自填'; } };
        search();
      }
      if (step === 2) {
        const disc = A.$('#disc'), cat = A.$('#cat'), maj = A.$('#maj'), q = A.$('#majorQ'), picked = A.$('#picked');
        const tree = (await A.get('/api/presets/majors/tree')).tree;
        disc.innerHTML = '<option value="">全部</option>' + Object.keys(tree).map((d) => '<option>' + d + '</option>').join('');
        const fillCat = () => {
          const d = disc.value;
          const cats = d ? Object.keys(tree[d] || {}) : Array.from(new Set(Object.values(tree).flatMap((x) => Object.keys(x))));
          cat.innerHTML = '<option value="">全部</option>' + cats.map((c) => '<option>' + c + '</option>').join('');
          fillMaj();
        };
        const fillMaj = async () => {
          const r = await A.get('/api/presets/majors?discipline=' + encodeURIComponent(disc.value) + '&category=' + encodeURIComponent(cat.value));
          maj.innerHTML = r.list.slice(0, 60).map((m) => '<option value="' + m.id + '" data-name="' + A.esc(m.name) + '" data-code="' + m.code + '" data-disc="' + A.esc(m.discipline) + '" data-cat="' + A.esc(m.category) + '">' + A.esc(m.name) + '（' + m.code + '）</option>').join('');
        };
        disc.onchange = fillCat; cat.onchange = fillMaj;
        fillCat();
        maj.onchange = () => { const o = maj.selectedOptions[0]; if (!o) return; draft.majorName = o.dataset.name; draft.majorCode = o.dataset.code; draft.discipline = o.dataset.disc; draft.majorCategory = o.dataset.cat; picked.textContent = draft.majorName; };
        let qt = null;
        q.oninput = () => { clearTimeout(qt); qt = setTimeout(async () => {
          const r = await A.get('/api/presets/majors?q=' + encodeURIComponent(q.value.trim()));
          if (!q.value.trim()) return;
          maj.innerHTML = r.list.slice(0, 60).map((m) => '<option value="' + m.id + '" data-name="' + A.esc(m.name) + '" data-code="' + m.code + '" data-disc="' + A.esc(m.discipline) + '" data-cat="' + A.esc(m.category) + '">' + A.esc(m.name) + '（' + A.esc(m.discipline) + ' · ' + m.code + '）</option>').join('');
          maj.onchange();
        }, 240); };
        if (draft.majorName) maj.onchange();
      }
      if (step === 3) {
        A.$('#term').innerHTML = ['大一上', '大一下', '大二上', '大二下', '大三上', '大三下', '大四上', '大四下', '大五上', '大五下'].map((t) => '<option' + (draft.term === t ? ' selected' : '') + '>' + t + '</option>').join('');
        A.$('#py').value = String(draft.programYears);
        A.$$('#gender .check-pill').forEach((b) => (b.onclick = () => { draft.gender = draft.gender === b.dataset.g ? '' : b.dataset.g; A.$$('#gender .check-pill').forEach((x) => x.classList.toggle('on', x.dataset.g === draft.gender)); }));
      }
      if (step === 4) {
        A.$$('#rest .check-pill').forEach((b) => (b.onclick = () => {
          const d = Number(b.dataset.d);
          draft.restDays = draft.restDays.includes(d) ? draft.restDays.filter((x) => x !== d) : draft.restDays.concat(d);
          b.classList.toggle('on');
        }));
      }
      A.$('#back').onclick = async () => {
        if (step === 1) { await A.put('/api/profile', { skip: true }); A.toast('已跳过', 'ok'); location.hash = '#/today'; return; }
        if (step === TOTAL) { await A.post('/api/self-report', { skip: true }); A.toast('已跳过', 'ok'); location.hash = '#/today'; return; }
        step--; renderStep();
      };
      A.$('#next').onclick = async () => {
        try {
          if (step === 1) { draft.school = A.$('#school').value.trim(); if (!draft.school) return A.toast('请填写院校', 'err'); }
          if (step === 2) { if (!draft.majorName) return A.toast('请选择专业', 'err'); }
          if (step === 3) {
            draft.enrollmentYear = Number(A.$('#year').value); draft.programYears = Number(A.$('#py').value); draft.term = A.$('#term').value; draft.department = A.$('#dept').value.trim();
          }
          if (step === 4) {
            draft.goal = A.$('#goal').value.trim(); draft.targetDate = A.$('#targetDate').value;
            draft.daysPerWeek = Number(A.$('#days').value); draft.minutesPerDay = Number(A.$('#minutes').value);
          }
          if (step === 5) {
            draft.selfText = A.$('#self').value;
            A.loading(true, '正在保存…');
            await A.put('/api/profile', draft);
            if (draft.goal) await A.post('/api/goals', { title: draft.goal, targetDate: draft.targetDate, type: '期末复习', priority: '高' });
            await A.put('/api/time-constraint', { daysPerWeek: draft.daysPerWeek, minutesPerDay: draft.minutesPerDay, restDays: draft.restDays });
            await A.post('/api/self-report', draft.selfText.trim() ? { rawText: draft.selfText } : { skip: true });
            A.loading(false);
            A.toast('已经准备好了', 'ok');
            location.hash = '#/today';
            return;
          }
          step++; renderStep();
        } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
      };
    }
    renderStep();
  });

  /* ============================== 今日 ============================== */
  A.register('today', async () => {
    if (!(await A.needProfile())) return;
    // 先取任务与休息日（不触发模型），页面立刻可见；当天建议需要生成，稍后异步补上
    const fast = await A.get('/api/today?nosuggest=1');
    renderToday(fast);
    if (!fast.suggestion && !fast.restToday) {
      A.get('/api/today').then((full) => {
        if (full && full.suggestion) renderToday(full);
        else renderToday(Object.assign({}, fast, { suggestFailed: true }));
      }).catch(() => renderToday(Object.assign({}, fast, { suggestFailed: true })));
    }
  });

  function renderToday(d) {
    const s = d.suggestion;
    let suggestionHtml = '';
    if (d.restToday) suggestionHtml = '<div class="card"><div class="row between"><h3>今天是休息日</h3>' + A.chip('休息', 'info') + '</div><p class="muted small mt8">按你设定的作息，今天不排任务。</p></div>';
    else if (s) {
      const st = { '待响应': '', '已学': 'ok', '已休息': 'info', '不感兴趣': '' }[s.status] || '';
      suggestionHtml = '<div class="card" style="border-color:#e2e5f7"><div class="row between"><div class="row">' + A.I.spark + '<h3>今天可以这样</h3></div>' + A.chip(s.status, st) + '</div>' +
        '<p class="mt8" style="font-size:15.5px">' + A.esc(s.content) + '</p>' +
        (s.reason ? '<p class="muted small">依据：' + A.esc(s.reason) + '</p>' : '') +
        (s.estimatedMinutes ? '<p class="muted small">大概 ' + s.estimatedMinutes + ' 分钟</p>' : '') +
        (s.status === '待响应'
          ? '<div class="row mt12" id="sfb"><button class="btn" data-f="done" style="flex:1">已经学了</button><button class="btn" data-f="rest" style="flex:1">今天休息</button><button class="btn" data-f="notinterested" style="flex:1">不想学这个</button></div>'
          : '<div class="mt12"><button class="btn ghost sm" id="undo">撤回</button></div>') + '</div>';
    } else suggestionHtml = '<div class="card"><p class="muted">' + (d.suggestFailed ? '今天的建议暂时生成不出来。' : '正在为你生成今天的建议…') + '</p></div>';

    const tasksHtml = d.tasks.length
      ? '<div class="col">' + d.tasks.map(taskCard).join('') + '</div>'
      : A.empty('今天没有任务', d.plans.length ? '去看看计划，或自己加一件小事' : '先上传一份资料，我来帮你排计划', '<a class="btn primary sm" href="#/docs">去上传资料</a>');

    A.render(A.head('今日', new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) + (d.plans.length ? ' · ' + A.esc(d.plans[0].title) : '')) +
      suggestionHtml +
      (d.overdueCount ? '<div class="card mt12"><div class="row between"><div><b>有 ' + d.overdueCount + ' 件之前的任务还没做</b></div><button class="btn sm" id="pushover">顺延</button></div></div>' : '') +
      '<div class="section-title">今日任务' + (d.tasks.length ? '（' + d.doneToday + '/' + d.tasks.length + ' 完成）' : '') + '</div>' + tasksHtml +
      '<div class="mt16"><button class="btn ghost sm" id="addtask">＋ 加一件小事</button></div>');

    function taskCard(t) {
      const done = t.status === '已完成';
      return '<div class="task' + (done ? ' done' : '') + '" data-task="' + t.id + '">' +
        '<div class="row between"><div class="t-title">' + A.esc(t.title) + '</div>' + A.statusChip(t.status) + '</div>' +
        '<div class="t-meta"><span>' + t.estimatedMinutes + ' 分钟</span>' + (t.chapter ? '<span>· ' + A.esc(t.chapter) + '</span>' : '') + (t.priority === '高' ? '<span>· 优先</span>' : '') + '</div>' +
        '<div class="small muted mt8">完成标准：' + A.esc(t.completionCriteria) + '</div>' +
        (t.reason ? '<div class="small muted">安排理由：' + A.esc(t.reason) + '</div>' : '') +
        (done ? '' : '<div class="t-actions"><button class="btn sm" data-a="进行中">开始学习</button><button class="btn sm primary" data-a="已完成">已完成</button><button class="btn sm" data-a="需调整">暂时做不到</button><button class="btn sm soft" data-a="help">需要帮助</button></div>') +
        '<div class="t-actions hidden" data-reason="' + t.id + '">' + ['时间不够', '内容太难', '资料不清楚', '临时有事', '不选了'].map((r, i) => '<button class="btn sm' + (i === 4 ? ' ghost' : '') + '" data-r="' + r + '">' + r + '</button>').join('') + '</div>' +
        '</div>';
    }

    A.$$('[data-task]').forEach((card) => {
      const id = card.dataset.task;
      A.$$('[data-a]', card).forEach((b) => (b.onclick = async () => {
        const a = b.dataset.a;
        if (a === 'help') { const t = d.tasks.find((x) => x.id === id); sessionStorage.setItem('solveTask', JSON.stringify({ id: t.id, title: t.title, criteria: t.completionCriteria, kp: (t.knowledgePoints || [])[0] || '' })); location.hash = '#/solve'; return; }
        if (a === '需调整') { A.$('[data-reason="' + id + '"]').classList.toggle('hidden'); return; }
        await setTask(id, a);
      }));
      A.$$('[data-r]', card).forEach((b) => (b.onclick = async () => {
        const r = b.dataset.r === '不选了' ? '' : b.dataset.r;
        await setTask(id, '需调整', r);
      }));
    });
    async function setTask(id, status, reason) {
      try {
        A.loading(true, '正在更新…');
        const r = await A.patch('/api/tasks/' + id, { status, reason });
        A.loading(false);
        if (r.reschedule && r.reschedule.changes && r.reschedule.changes.length) A.toast(r.reschedule.note || '后面的安排已重新排好', 'ok');
        else if (status === '已完成') A.toast('记下了', 'ok');
        A.route();
      } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    }
    if (A.$('#sfb')) A.$$('#sfb [data-f]').forEach((b) => (b.onclick = async () => {
      try {
        A.loading(true, '正在记录…');
        await A.post('/api/suggestions/' + s.id + '/feedback', { type: b.dataset.f });
        A.loading(false);
        A.toast(b.dataset.f === 'rest' ? '今天好好休息' : '已记录', 'ok');
        A.route();
      } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    }));
    if (A.$('#undo')) A.$('#undo').onclick = async () => { await A.del('/api/suggestions/' + s.id + '/feedback'); A.route(); };
    if (A.$('#pushover')) A.$('#pushover').onclick = async () => {
      const plans = await A.get('/api/plans');
      const active = plans.list.filter((p) => p.status === '进行中')[0];
      if (!active) return A.toast('还没有进行中的计划', 'err');
      A.loading(true, '正在顺延…'); const r = await A.post('/api/plans/' + active.id + '/reschedule', { reason: '顺延未完成任务' }); A.loading(false);
      A.toast(r.note || '已顺延', 'ok'); A.route();
    };
    if (A.$('#addtask')) A.$('#addtask').onclick = () => {
      A.modal({
        title: '加一件小事', body: '<div class="field"><label>做什么</label><input id="t"></div>' +
          '<div class="grid two"><div class="field"><label>多久（分钟）</label><input id="m" type="number" value="30"></div><div class="field"><label>完成标准</label><input id="c" placeholder="怎么做算完成"></div></div>',
        actions: [{ label: '取消' }, {
          label: '添加', kind: 'primary', onClick: async (w) => {
            try { await A.post('/api/tasks', { title: A.$('#t', w).value, estimatedMinutes: Number(A.$('#m', w).value), completionCriteria: A.$('#c', w).value }); A.toast('已加入今天', 'ok'); A.route(); }
            catch (e) { A.toast(e.message, 'err'); return false; }
          }
        }]
      });
    };
  }

  /* ============================= AI 搜题 ============================= */
  const solveState = { mode: 'text', images: [], question: '', supplement: '', record: null, task: null };

  A.register('solve', async (args) => {
    if (!(await A.needProfile())) return;
    const view = args[0] || 'ask';
    if (view === 'history') return renderHistory();
    if (view === 'stats') return renderStats();
    const st = sessionStorage.getItem('solveTask');
    solveState.task = st ? JSON.parse(st) : null;
    renderAsk();
  });

  function renderAsk() {
    const t = solveState.task;
    A.render(A.head('AI 搜题', '文字或拍照都能问，解答会给出完整过程') +
      (t ? '<div class="card pad-sm mb12"><div class="row between"><div class="small">正在学：<b>' + A.esc(t.title) + '</b>' + (t.criteria ? '<span class="muted"> · ' + A.esc(t.criteria) + '</span>' : '') + '</div><button class="btn ghost sm" id="cleartask">退出该任务</button></div></div>' : '') +
      '<div class="card">' +
      '<div class="row between mb12"><div class="segmented" id="mode"><button data-m="text" class="' + (solveState.mode === 'text' ? 'active' : '') + '">文字题目</button><button data-m="image" class="' + (solveState.mode === 'image' ? 'active' : '') + '">拍照 / 图片</button></div>' +
      '<div class="row"><a class="btn ghost sm" href="#/solve/history">历史</a><a class="btn ghost sm" href="#/solve/stats">统计</a></div></div>' +
      '<div id="inputArea"></div>' +
      '<div class="field mt12"><label>补充说明（选填）</label><input id="supp" value="' + A.esc(solveState.supplement) + '"></div>' +
      '<button class="btn primary block" id="ask">开始解答</button>' +
      '' +
      '</div>' +
      '<div id="answerArea" class="mt16"></div>' +
      '<div class="section-title">最近的题</div><div id="recent" class="card"><div class="inline-loading"><div class="spinner"></div>加载中…</div></div>');

    function drawInput() {
      const area = A.$('#inputArea');
      if (solveState.mode === 'text') {
        area.innerHTML = '<div class="field"><label>题目</label><textarea id="q" rows="7">' + A.esc(solveState.question) + '</textarea></div>';
        A.$('#q').oninput = (e) => (solveState.question = e.target.value);
      } else {
        area.innerHTML = '<div class="field"><label>题目照片（最多 3 张）</label>' +
          '<div class="drop" id="drop">点击选择图片，或把图片拖进来</div><input type="file" accept="image/*" multiple id="file" class="hidden">' +
          '<div class="thumbs" id="thumbs"></div></div>' +
          (solveState.images.length ? '<button class="btn block mb12" id="ocr">识别图片里的题目</button>' : '') +
          '<div class="field"><label>识别到的题干（可以改）</label><textarea id="q" rows="5" placeholder="识别后会出现在这里，先核对再解答">' + A.esc(solveState.question) + '</textarea></div>';
        A.$('#drop').onclick = () => A.$('#file').click();
        A.$('#file').onchange = (e) => addFiles(e.target.files);
        A.$('#drop').ondragover = (e) => { e.preventDefault(); };
        A.$('#drop').ondrop = (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); };
        A.$('#q').oninput = (e) => (solveState.question = e.target.value);
        drawThumbs();
        if (A.$('#ocr')) A.$('#ocr').onclick = async () => {
          try {
            A.loading(true, '正在识别图片…');
            const r = await A.post('/api/solve/image-extract', { images: solveState.images.map((i) => ({ mime: i.mime, base64: i.base64 })) });
            A.loading(false);
            if (!r.ok) { A.toast(r.error || '识别没有成功', 'err'); return; }
            if (!r.detected) { A.toast('这张图里好像没有题目，换一张试试', 'err'); return; }
            solveState.question = r.questionText;
            A.$('#q').value = r.questionText;
            if (r.note) A.toast('识别完成，请核对：' + r.note);
            else A.toast('识别完成，核对一下再点开始解答', 'ok');
          } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
        };
      }
    }
    function drawThumbs() {
      const box = A.$('#thumbs');
      if (!box) return;
      box.innerHTML = solveState.images.map((im, i) => '<div class="thumb"><img src="' + im.preview + '"><button data-i="' + i + '">×</button></div>').join('');
      A.$$('button', box).forEach((b) => (b.onclick = () => { solveState.images.splice(Number(b.dataset.i), 1); renderAsk(); }));
    }
    function addFiles(files) {
      const list = Array.from(files || []).slice(0, 3);
      if (!list.length) return;
      if (solveState.images.length + list.length > 3) { A.toast('一次最多 3 张图片', 'err'); return; }
      let left = list.length;
      list.forEach((f) => {
        if (!f.type.startsWith('image/')) { A.toast('请选择图片文件', 'err'); left--; if (!left) renderAsk(); return; }
        if (f.size > 6 * 1024 * 1024) { A.toast('单张图片请控制在 6MB 以内', 'err'); left--; if (!left) renderAsk(); return; }
        const fr = new FileReader();
        fr.onload = () => {
          const dataUrl = String(fr.result);
          solveState.images.push({ mime: f.type, base64: dataUrl.split(',')[1], preview: dataUrl });
          left--; if (!left) renderAsk();
        };
        fr.readAsDataURL(f);
      });
    }

    A.$$('#mode button').forEach((b) => (b.onclick = () => { solveState.mode = b.dataset.m; renderAsk(); }));
    if (A.$('#cleartask')) A.$('#cleartask').onclick = () => { sessionStorage.removeItem('solveTask'); solveState.task = null; renderAsk(); };
    drawInput();

    A.$('#supp').oninput = (e) => (solveState.supplement = e.target.value);
    A.$('#ask').onclick = async () => {
      if (!solveState.question.trim() && !solveState.images.length) return A.toast('先写下题目，或上传一张图片', 'err');
      try {
        A.loading(true, '正在解题…');
        const r = await A.post('/api/solve', {
          question: solveState.question, supplement: solveState.supplement,
          images: solveState.images.map((i) => ({ mime: i.mime, base64: i.base64 })),
          taskId: solveState.task ? solveState.task.id : undefined
        });
        A.loading(false);
        solveState.record = r.record;
        drawAnswer();
        if (r.degraded) A.toast('这次生成不太顺利，可以点重新生成', 'err');
        loadRecent();
      } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
    };

    function drawAnswer() {
      const rec = solveState.record;
      if (!rec) return;
      const a = rec.answer || {};
      const area = A.$('#answerArea');
      area.innerHTML = '<div class="card"><div class="row between mb8"><h3>解答</h3><div class="chips">' +
        A.chip(rec.subject || '未标注', 'brand') + A.chip(rec.difficulty || '—') + A.chip(rec.knowledgeTopic || '—') + A.chip(rec.questionType || '—') +
        (rec.annotationSource === '学生手动修正' ? A.chip('已修正', 'ok') : '') + '</div></div>' +
        (a.degraded ? '<div class="empty mb12">这次没有生成成功，可以重新生成</div>' : '') +
        '<div class="answer-block"><b class="small muted">题目理解</b><div>' + A.esc(a.understanding || '') + '</div></div>' +
        '<div class="answer-block"><b class="small muted">涉及知识点</b><div class="chips mt8">' + (a.knowledgePoints || []).map((k) => A.chip(k)).join('') + '</div></div>' +
        '<div class="answer-block"><b class="small muted">解题思路</b><div>' + A.esc(a.approach || '') + '</div></div>' +
        '<div class="mt12"><b class="small muted">逐步推导</b>' + (a.steps || []).map((s, i) => '<div class="answer-step"><div class="step-no">' + (i + 1) + '</div><div class="step-body"><b>' + A.esc(s.title) + '</b><div>' + A.esc(s.detail) + '</div></div></div>').join('') + '</div>' +
        '<div class="answer-block mt12"><b class="small muted">结论与检验</b><div>' + A.esc(a.answer || '') + (a.verify ? '<div class="muted small mt8">检验：' + A.esc(a.verify) + '</div>' : '') + '</div></div>' +
        '<div class="answer-block"><b class="small muted">易错提示</b><div><ul style="margin:6px 0 0 18px;padding:0">' + (a.pitfalls || []).map((p) => '<li>' + A.esc(p) + '</li>').join('') + '</ul></div></div>' +
        '<div class="row wrap mt16"><button class="btn sm" id="fix">改标注</button><button class="btn sm" id="resolved">标记已解决</button><button class="btn sm" id="unresolved">还是不太懂</button><button class="btn sm ghost" id="regen">重新生成</button></div>' +
        '<div class="hr"></div>' +
        '<div class="field"><label>继续追问</label><div class="row"><input id="fu"><button class="btn primary" id="fubtn">问</button></div></div>' +
        '<div id="fulist"></div>' +
        '<div class="mt12"><a class="btn ghost sm" href="#/solve/history">看历史记录</a></div></div>';
      A.$('#fix').onclick = () => openAnnotation(rec);
      A.$('#resolved').onclick = () => markResolved(rec.id, '已解决');
      A.$('#unresolved').onclick = () => markResolved(rec.id, '未解决');
      A.$('#regen').onclick = () => A.$('#ask').click();
      A.$('#fubtn').onclick = async () => {
        const q = A.$('#fu').value.trim();
        if (!q) return;
        try {
          A.loading(true, '正在回答…');
          const r = await A.post('/api/solve/' + rec.id + '/followup', { question: q });
          A.loading(false);
          if (!r.ok) { A.toast(r.error || '回答失败', 'err'); return; }
          A.$('#fu').value = '';
          A.$('#fulist').insertAdjacentHTML('beforeend', '<div class="answer-block"><b class="small muted">你问</b><div>' + A.esc(q) + '</div><div class="mt8">' + A.esc(r.reply) + '</div></div>' +
            (r.followups && r.followups.length ? '<div class="chips mt8">' + r.followups.map((f) => '<div class="chip" data-fq="' + A.esc(f) + '" style="cursor:pointer">' + A.esc(f) + '</div>').join('') + '</div>' : ''));
          A.$$('[data-fq]').forEach((c) => (c.onclick = () => { A.$('#fu').value = c.dataset.fq; }));
        } catch (e) { A.loading(false); A.toast(e.message, 'err'); }
      };
      area.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function openAnnotation(rec) {
      A.modal({
        title: '修改标注', body:
          '<div class="field"><label>学科</label><input id="a1" value="' + A.esc(rec.subject || '') + '"></div>' +
          '<div class="field"><label>知识点 / 章节</label><input id="a2" value="' + A.esc(rec.knowledgeTopic || '') + '"></div>' +
          '<div class="grid two"><div class="field"><label>难度</label><select id="a3">' + ['基础', '中等', '较难', '困难'].map((d) => '<option' + (rec.difficulty === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select></div>' +
          '<div class="field"><label>题型</label><select id="a4">' + ['选择题', '填空题', '计算题', '证明题', '编程题', '问答题', '其他'].map((d) => '<option' + (rec.questionType === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select></div></div>',
        actions: [{ label: '取消' }, {
          label: '保存', kind: 'primary', onClick: async (w) => {
            try {
              const r = await A.patch('/api/solve/' + rec.id + '/annotation', { subject: A.$('#a1', w).value, knowledgeTopic: A.$('#a2', w).value, difficulty: A.$('#a3', w).value, questionType: A.$('#a4', w).value });
              solveState.record = r.record; A.toast('已按你的修正更新', 'ok'); drawAnswer();
            } catch (e) { A.toast(e.message, 'err'); return false; }
          }
        }]
      });
    }
    async function markResolved(id, v) {
      try { const r = await A.patch('/api/solve/' + id + '/annotation', { resolved: v }); solveState.record = r.record; A.toast(v === '已解决' ? '太好了' : '可以再追问几句', 'ok'); }
      catch (e) { A.toast(e.message, 'err'); }
    }
    async function loadRecent() {
      try {
        const r = await A.get('/api/solve/history?limit=5');
        A.$('#recent').innerHTML = r.list.length ? r.list.map((q) => '<div class="list-item"><div class="li-main"><div class="li-title">' + A.esc(String(q.questionText).slice(0, 46) || '（图片题）') + '</div><div class="li-sub">' + A.fmtDateTime(q.createdAt) + ' · ' + A.esc(q.subject || '未标注') + ' · ' + A.esc(q.knowledgeTopic || '') + '</div></div></div>').join('') : A.empty('还没有搜过题', '第一道题可以从今天作业里挑');
      } catch (e) {}
    }
    loadRecent();
  }

  async function renderHistory() {
    const r = await A.get('/api/solve/history?limit=50');
    A.render(A.head('搜题历史', '共 ' + r.total + ' 条', '<a class="btn sm" href="#/solve">回到搜题</a>') +
      (r.list.length ? '<div class="card">' + r.list.map((q) =>
        '<div class="list-item" data-id="' + q.id + '"><div class="li-main"><div class="li-title">' + A.esc(String(q.questionText).slice(0, 60) || '（图片题）') + '</div>' +
        '<div class="li-sub">' + A.fmtDateTime(q.createdAt) + ' · ' + A.esc(q.subject || '未标注') + ' · ' + A.esc(q.knowledgeTopic || '') + ' · ' + A.esc(q.difficulty || '') + (q.followups ? ' · 追问 ' + q.followups + ' 次' : '') + '</div></div>' +
        '<div class="row"><button class="btn sm ghost" data-open="' + q.id + '">查看</button><button class="btn sm ghost" data-del="' + q.id + '">删除</button></div></div>').join('') + '</div>'
        : A.empty('还没有记录', '去搜一道题试试', '<a class="btn primary sm" href="#/solve">去搜题</a>')));
    A.$$('[data-del]').forEach((b) => (b.onclick = () => A.confirmDialog('删除这条记录？', '删除后统计也会同步更新。', async () => { await A.del('/api/solve/' + b.dataset.del); A.toast('已删除', 'ok'); renderHistory(); }, '删除')));
    A.$$('[data-open]').forEach((b) => (b.onclick = async () => {
      const r2 = await A.get('/api/solve/' + b.dataset.open);
      const rec = r2.record, a = rec.answer || {};
      A.modal({
        title: '这道题', body: '<p class="small muted">' + A.fmtDateTime(rec.createdAt) + ' · ' + A.esc(rec.subject || '') + ' · ' + A.esc(rec.knowledgeTopic || '') + '</p>' +
          '<div class="mt8"><b>题目</b><p>' + A.esc(String(rec.questionText).slice(0, 600) || '（图片题）') + '</p></div>' +
          (a.steps ? '<div class="mt8"><b>推导</b>' + a.steps.map((s, i) => '<div class="answer-step"><div class="step-no">' + (i + 1) + '</div><div class="step-body"><b>' + A.esc(s.title) + '</b><div>' + A.esc(s.detail) + '</div></div></div>').join('') + '</div>' : '') +
          (a.answer ? '<div class="answer-block mt8"><b>结论</b><div>' + A.esc(a.answer) + '</div></div>' : ''),
        actions: [{ label: '关闭' }]
      });
    }));
  }

  async function renderStats() {
    let range = '30';
    async function draw() {
      const s = await A.get('/api/solve/stats?range=' + range);
      A.render(A.head('搜题统计', '只看你本人的数据', '<a class="btn sm" href="#/solve">回到搜题</a>') +
        '<div class="segmented mb16" id="range">' + [['7', '近 7 天'], ['30', '近 30 天'], ['term', '本学期'], ['all', '全部']].map(([k, l]) => '<button data-r="' + k + '" class="' + (range === k ? 'active' : '') + '">' + l + '</button>').join('') + '</div>' +
        '<div class="grid three mb12">' +
        '<div class="card pad-sm"><div class="muted small">搜题总数</div><div style="font-size:22px;font-weight:700">' + s.total + '</div></div>' +
        '<div class="card pad-sm"><div class="muted small">覆盖学科</div><div style="font-size:22px;font-weight:700">' + s.coverage.subjects + '</div></div>' +
        '<div class="card pad-sm"><div class="muted small">覆盖知识点</div><div style="font-size:22px;font-weight:700">' + s.coverage.topics + '</div></div></div>' +
        '<div class="card"><div class="card-title"><h3>各学科搜题量</h3><span class="muted small">点柱子看知识点</span></div><div id="c1"></div></div>' +
        '<div class="card"><div class="card-title"><h3>难度分布</h3></div><div id="c2"></div></div>' +
        '<div id="drill"></div>' +
        '<p class="muted small mt12">问得多只说明这里疑问多，不代表学得不好。</p>');
      A.$('#c1').innerHTML = A.chart('c1', s.subjects);
      A.$('#c2').innerHTML = A.chart('c2', s.difficulties, { color: '#8b8ff5' });
      A.bindChart(A.$('#c1'), (name) => {
        const g = s.topics.find((x) => x.subject === name);
        A.$('#drill').innerHTML = g
          ? '<div class="card"><div class="card-title"><h3>' + A.esc(name) + ' 下面各部分</h3><span class="muted small">' + g.items.reduce((a, b) => a + b.count, 0) + ' 次</span></div><div id="c3"></div></div>'
          : '<div class="card"><p class="muted">这个学科下还没有可下钻的知识点。</p></div>';
        if (g) { A.$('#c3').innerHTML = A.chart('c3', g.items, { color: '#22a06b' }); A.bindChart(A.$('#c3'), (n) => A.go('solve/history')); }
      });
      A.$$('#range button').forEach((b) => (b.onclick = () => { range = b.dataset.r; draw(); }));
    }
    await draw();
  }
})();
