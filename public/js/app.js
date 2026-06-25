(function(){
'use strict';

// ── State ──
const state = {
  user: null,
  token: localStorage.getItem('token') || null,
};

// ── Helpers ──
function $(sel, ctx) { return (ctx||document).querySelector(sel); }
function $$(sel, ctx) { return Array.from((ctx||document).querySelectorAll(sel)); }
function escHtml(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

function formatDate(d) {
  if (!d) return '';
  const parts = d.split('-');
  return parts[0]+'年'+parseInt(parts[1])+'月'+parseInt(parts[2])+'日';
}

function showToast(msg, type) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' '+type : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ── API ──
async function api(method, path, body, isFormData) {
  const headers = {};
  if (state.token) headers['Authorization'] = 'Bearer '+state.token;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(path, {
      method,
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });

    if (res.status === 401) {
      state.token = null;
      state.user = null;
      localStorage.removeItem('token');
      render();
      return null;
    }

    return await res.json();
  } catch(e) {
    showToast('网络错误: '+e.message, 'error');
    return null;
  }
}

// ── Render ──
function render() {
  const app = document.getElementById('app');
  const hash = window.location.hash.slice(1) || 'login';

  if (!state.token || !state.user) {
    if (hash === 'setup') { renderSetup(app); return; }
    renderLogin(app);
    return;
  }

  if (state.user.role === 'teacher') {
    if (hash.startsWith('detail/')) { renderDetail(app, hash.split('/')[1]); return; }
    renderTeacher(app);
  } else {
    renderStudent(app);
  }
}

// ── Login Page ──
function renderLogin(app) {
  app.innerHTML =
    '<div class="login-page">' +
      '<div class="login-logo">🎸</div>' +
      '<div class="login-title">桃园Guitar🎸拾遗</div>' +
      '<div class="login-subtitle">练琴的点点滴滴，都值得拾起</div>' +
      '<form class="login-form" id="login-form">' +
        '<div class="form-group">' +
          '<label>用户名</label>' +
          '<input class="input" name="name" placeholder="你的名字" required>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>密码</label>' +
          '<input class="input" name="password" type="password" placeholder="密码" required>' +
        '</div>' +
        '<button class="btn btn-primary" type="submit">登录</button>' +
        '<div class="login-error" id="login-error"></div>' +
      '</form>' +
    '</div>';

  app.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = $('#login-error');

    const res = await api('POST', '/api/login', {
      name: fd.get('name'),
      password: fd.get('password'),
    });

    if (!res || res.error) {
      errEl.textContent = res ? res.error : '登录失败';
      return;
    }

    state.token = res.token;
    state.user = res.user;
    localStorage.setItem('token', res.token);
    window.location.hash = state.user.role === 'teacher' ? '#teacher' : '#student';
  });

  // Check if setup needed
  api('GET', '/api/setup/status').then(res => {
    if (res && res.needsSetup) {
      window.location.hash = '#setup';
    }
  });
}

// ── Setup Page ──
function renderSetup(app) {
  app.innerHTML =
    '<div class="setup-page">' +
      '<h2>🎸 首次设置</h2>' +
      '<p class="subtitle">创建老师和徒弟账号，之后可随时登录</p>' +
      '<form id="setup-form">' +
        '<div class="section-title">👨‍🏫 老师</div>' +
        '<div class="form-group"><label>老师名字</label><input class="input" name="teacherName" placeholder="老师" required></div>' +
        '<div class="form-group"><label>密码</label><input class="input" type="password" name="teacherPassword" placeholder="至少4位" minlength="4" required></div>' +

        '<div class="section-title">🎓 徒弟 1</div>' +
        '<div class="form-group"><label>名字</label><input class="input" name="student1Name" placeholder="比如：小明"></div>' +
        '<div class="form-group"><label>密码</label><input class="input" type="password" name="student1Password" placeholder="至少4位" minlength="4"></div>' +

        '<div class="section-title">🎓 徒弟 2</div>' +
        '<div class="form-group"><label>名字</label><input class="input" name="student2Name" placeholder="比如：小红"></div>' +
        '<div class="form-group"><label>密码</label><input class="input" type="password" name="student2Password" placeholder="至少4位" minlength="4"></div>' +

        '<button class="btn btn-primary" type="submit" style="width:100%;margin-top:8px">创建账号</button>' +
        '<div id="setup-error" class="login-error"></div>' +
      '</form>' +
    '</div>';

  app.querySelector('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = $('#setup-error');

    const data = {};
    ['teacherName','teacherPassword','student1Name','student1Password','student2Name','student2Password'].forEach(k => {
      data[k] = fd.get(k) || '';
    });

    const res = await api('POST', '/api/setup', data);
    if (!res || res.error) {
      errEl.textContent = res ? res.error : '创建失败';
      return;
    }

    showToast('账号创建成功！请登录', 'success');
    window.location.hash = '#login';
  });
}

// ── Student Page ──
function renderStudent(app) {
  app.innerHTML =
    '<div class="header">' +
      '<h1>🎸 桃园拾遗</h1>' +
      '<div class="user-info">' +
        '<span>'+escHtml(state.user.name)+'</span>' +
        '<button class="logout-btn" id="logout-btn">退出</button>' +
      '</div>' +
    '</div>' +
    '<div class="container" id="student-content">' +
      '<div class="loading">加载中...</div>' +
    '</div>';

  $('#logout-btn').addEventListener('click', () => {
    state.token = null;
    state.user = null;
    localStorage.removeItem('token');
    render();
  });

  loadStudentPage();
}

async function loadStudentPage() {
  const container = $('#student-content');
  if (!container) return;

  container.innerHTML =
    '<div class="checkin-section">' +
      '<h2>📝 今日打卡</h2>' +
      '<form id="checkin-form">' +
        '<div class="form-group">' +
          '<label>练习日期</label>' +
          '<input class="input" name="date" type="date" value="'+todayStr()+'">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>练习时长</label>' +
          '<div class="duration-quick" id="duration-quick">' +
            '<button type="button" class="duration-btn" data-min="15">15分钟</button>' +
            '<button type="button" class="duration-btn" data-min="30">30分钟</button>' +
            '<button type="button" class="duration-btn" data-min="45">45分钟</button>' +
            '<button type="button" class="duration-btn" data-min="60">60分钟</button>' +
          '</div>' +
          '<input class="input" name="duration_minutes" type="number" min="1" placeholder="或手动输入分钟数" style="margin-top:8px">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>弹了什么</label>' +
          '<input class="input" name="content" placeholder="例：C大调音阶、加州旅馆前奏" required>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>备注（可选）</label>' +
          '<textarea class="input" name="notes" placeholder="手指状态、遇到的问题、小感悟..." rows="2"></textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>录制视频（可选）</label>' +
          '<div class="file-upload">' +
            '<input type="file" id="video-input" accept="video/*">' +
            '<label class="file-label" for="video-input" id="video-label">📹 点击选择视频文件</label>' +
          '</div>' +
        '</div>' +
        '<button class="btn btn-primary" type="submit" style="width:100%">✅ 打卡</button>' +
      '</form>' +
    '</div>' +
    '<div class="history-section">' +
      '<h2>📋 练习记录</h2>' +
      '<div id="history-list"><div class="loading">加载中...</div></div>' +
    '</div>';

  // Duration quick select
  let selectedDuration = null;
  $$('.duration-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.duration-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedDuration = parseInt(btn.dataset.min, 10);
      $('input[name="duration_minutes"]').value = selectedDuration;
    });
  });

  // Video file label
  $('#video-input').addEventListener('change', (e) => {
    const label = $('#video-label');
    if (e.target.files && e.target.files[0]) {
      label.textContent = '✅ ' + e.target.files[0].name;
      label.className = 'file-label has-file';
    } else {
      label.textContent = '📹 点击选择视频文件';
      label.className = 'file-label';
    }
  });

  // Submit checkin
  $('#checkin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const formData = new FormData();
    formData.append('date', fd.get('date'));
    formData.append('duration_minutes', fd.get('duration_minutes') || '0');
    formData.append('content', fd.get('content') || '记录');
    formData.append('notes', fd.get('notes'));

    const videoInput = $('#video-input');
    if (videoInput.files && videoInput.files[0]) {
      formData.append('video', videoInput.files[0]);
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = '提交中...';

    const res = await api('POST', '/api/checkin', formData, true);
    btn.disabled = false;
    btn.textContent = '✅ 打卡';

    if (res && res.success) {
      showToast('打卡成功！🎉', 'success');
      e.target.reset();
      $('input[name="date"]').value = todayStr();
      $('#video-label').textContent = '📹 点击选择视频文件';
      $('#video-label').className = 'file-label';
      loadHistory();
    } else if (res) {
      showToast(res.error || '提交失败', 'error');
    }
  });

  // Load history
  loadHistory();
}

async function loadHistory() {
  const list = $('#history-list');
  if (!list) return;
  list.innerHTML = '<div class="loading">加载中...</div>';

  const data = await api('GET', '/api/checkins');
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="no-checkins"><p>还没有练习记录</p><p style="font-size:13px">在上面打卡吧 💪</p></div>';
    return;
  }

  list.innerHTML = '<div class="timeline">' +
    data.map(c =>
      '<div class="timeline-item">' +
        '<div class="timeline-date">'+formatDate(c.date)+'</div>' +
        '<div class="timeline-body">' +
          '<div class="meta">' +
            '<span class="duration">⏱ '+c.duration_minutes+'分钟</span>' +
            (c.video_url ? '<span>📹 有视频</span>' : '') +
          '</div>' +
          '<div class="content">'+escHtml(c.content)+'</div>' +
          (c.notes ? '<div class="notes">'+escHtml(c.notes)+'</div>' : '') +
          (c.video_url ?
            '<video class="video-player" controls preload="metadata">' +
              '<source src="'+escHtml(c.video_url)+'">' +
            '</video>' : '') +
          '<div style="margin-top:6px;text-align:right">' +
            '<button class="delete-btn" data-id="'+c.id+'">删除</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    ).join('') +
    '</div>';

  // Delete handlers
  $$('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除这条记录？')) return;
      const res = await api('DELETE', '/api/checkins/'+btn.dataset.id);
      if (res && res.success) {
        showToast('已删除', 'success');
        loadHistory();
      }
    });
  });
}

// ── Teacher Page ──
function renderTeacher(app) {
  app.innerHTML =
    '<div class="header">' +
      '<h1>🎸 桃园拾遗</h1>' +
      '<div class="user-info">' +
        '<span>老师 '+escHtml(state.user.name)+'</span>' +
        '<button class="logout-btn" id="logout-btn">退出</button>' +
      '</div>' +
    '</div>' +
    '<div class="container">' +
      '<div class="checkin-section">' +
        '<h2>📝 我的记录</h2>' +
        '<form id="teacher-checkin-form">' +
          '<div class="form-group">' +
            '<label>日期</label>' +
            '<input class="input" name="date" type="date" value="'+todayStr()+'">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>弹了什么</label>' +
            '<input class="input" name="content" placeholder="例：音阶练习、加州旅馆">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>心情/备注</label>' +
            '<textarea class="input" name="notes" placeholder="今天练习的感受、遇到的问题、想记录的事..." rows="5" style="min-height:120px"></textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label>视频（可选）</label>' +
            '<div class="file-upload">' +
              '<input type="file" id="teacher-video-input" accept="video/*">' +
              '<label class="file-label" for="teacher-video-input" id="teacher-video-label">📹 选择视频文件</label>' +
            '</div>' +
          '</div>' +
          '<button class="btn btn-primary" type="submit" style="width:100%">✅ 提交</button>' +
        '</form>' +
      '</div>' +
    '</div>' +
    '<div class="container" id="teacher-content">' +
      '<div class="loading">加载中...</div>' +
    '</div>';

  $('#logout-btn').addEventListener('click', () => {
    state.token = null;
    state.user = null;
    localStorage.removeItem('token');
    render();
  });

  loadTeacherPage();
}

async function loadTeacherPage() {
  const container = $('#teacher-content');
  if (!container) return;

  // Stats
  const [stats, students] = await Promise.all([
    api('GET', '/api/stats'),
    api('GET', '/api/students'),
  ]);

  if (!stats) return;

  let html = '';

  // Stats bar
  html +=
    '<div class="stats-bar">' +
      '<div class="stat-box"><div class="num">'+stats.total+'</div><div class="label">总打卡</div></div>' +
      '<div class="stat-box"><div class="num">'+stats.totalMinutes+'</div><div class="label">总分钟</div></div>' +
      '<div class="stat-box"><div class="num">'+stats.todayCount+'</div><div class="label">今日</div></div>' +
    '</div>';

  // Student cards
  if (students && students.length > 0) {
    html += '<div class="dashboard-grid">';
    students.forEach(s => {
      html +=
        '<div class="student-card">' +
          '<h3>🎓 '+escHtml(s.name)+'</h3>' +
          '<div class="stat-row"><span>累计打卡</span><span>'+s.total_checkins+' 次</span></div>' +
          '<div class="stat-row"><span>累计练习</span><span>'+s.total_minutes+' 分钟</span></div>' +
          '<div class="stat-row"><span>最近打卡</span><span>'+(s.last_checkin_date ? formatDate(s.last_checkin_date) : '还没有')+'</span></div>' +
        '</div>';
    });
    html += '</div>';
  }

  // All recent checkins
  html += '<h2 style="font-size:18px;font-weight:700;margin-bottom:12px">📋 最新打卡</h2>';
  html += '<div id="teacher-checkins"><div class="loading">加载中...</div></div>';

  container.innerHTML = html;

  // Load checkins
  const checkins = await api('GET', '/api/checkins?limit=30');
  const listEl = $('#teacher-checkins');
  if (!listEl) return;

  if (!checkins || checkins.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>还没有打卡记录</p></div>';
    return;
  }

  listEl.innerHTML =
    '<div class="timeline">' +
    checkins.map(c =>
      '<div class="timeline-item">' +
        '<div class="timeline-date">'+formatDate(c.date)+' &middot; '+escHtml(c.user_name)+'</div>' +
        '<div class="timeline-body" style="cursor:pointer" data-id="'+c.id+'">' +
          '<div class="meta">' +
            '<span class="duration">⏱ '+c.duration_minutes+'分钟</span>' +
            (c.video_url ? '<span>📹 有视频</span>' : '') +
          '</div>' +
          '<div class="content">'+escHtml(c.content)+'</div>' +
          (c.notes ? '<div class="notes">'+escHtml(c.notes)+'</div>' : '') +
        '</div>' +
      '</div>'
    ).join('') +
    '</div>';

  // Click to detail
  $$('.timeline-body[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      window.location.hash = '#detail/'+el.dataset.id;
    });
  });

  // Teacher checkin form
  setupTeacherCheckin();

}
function setupTeacherCheckin() {
  const form = document.getElementById('teacher-checkin-form');
  if (!form) return;

  // Duration quick select
  const btns = form.querySelectorAll('.duration-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', function() {
      btns.forEach(b => b.classList.remove('selected'));
      this.classList.add('selected');
      form.querySelector('input[name="duration_minutes"]').value = this.dataset.min;
    });
  });

  // Video file label
  const videoInput = document.getElementById('teacher-video-input');
  if (videoInput) {
    videoInput.addEventListener('change', function(e) {
      const label = document.getElementById('teacher-video-label');
      if (e.target.files && e.target.files[0]) {
        label.textContent = '\u2705 ' + e.target.files[0].name;
        label.className = 'file-label has-file';
      } else {
        label.textContent = '\uD83D\uDCF9 选择视频文件';
        label.className = 'file-label';
      }
    });
  }

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const formData = new FormData();
    formData.append('date', fd.get('date'));
    formData.append('duration_minutes', fd.get('duration_minutes') || '0');
    formData.append('content', fd.get('content') || '记录');
    formData.append('notes', fd.get('notes'));

    const vInput = document.getElementById('teacher-video-input');
    if (vInput && vInput.files && vInput.files[0]) {
      formData.append('video', vInput.files[0]);
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = '提交中...';

    const res = await api('POST', '/api/checkin', formData, true);
    btn.disabled = false;
    btn.textContent = '\u2705 提交';

    if (res && res.success) {
      showToast('提交成功！', 'success');
      form.reset();
      document.getElementById('teacher-video-label').textContent = '\uD83D\uDCF9 选择视频文件';
      document.getElementById('teacher-video-label').className = 'file-label';
      // Reload teacher page content
      loadTeacherPage();
    } else if (res) {
      showToast(res.error || '提交失败', 'error');
    }
  });
}
// ── Detail Page ──
async function renderDetail(app, id) {
  app.innerHTML =
    '<div class="detail-page">' +
      '<div class="back" id="back-btn">← 返回</div>' +
      '<div class="loading">加载中...</div>' +
    '</div>';

  $('#back-btn').addEventListener('click', () => {
    window.history.back();
  });

  const data = await api('GET', '/api/checkins/'+id);
  if (!data || data.error) {
    app.querySelector('.loading').outerHTML = '<div class="empty-state"><p>'+(data ? data.error : '加载失败')+'</p></div>';
    return;
  }

  app.innerHTML =
    '<div class="detail-page">' +
      '<div class="back" id="back-btn">← 返回</div>' +
      '<div class="card">' +
        '<div class="detail-meta">' +
          '<span>📅 '+formatDate(data.date)+'</span>' +
          '<span>👤 '+escHtml(data.user_name)+'</span>' +
          '<span class="duration">⏱ '+data.duration_minutes+'分钟</span>' +
        '</div>' +
        '<div class="detail-content">'+escHtml(data.content)+'</div>' +
        (data.notes ? '<div class="detail-notes">📝 '+escHtml(data.notes)+'</div>' : '') +
      '</div>' +
      (data.video_url ?
        '<div class="card"><div class="detail-video"><video controls preload="auto"><source src="'+escHtml(data.video_url)+'"></video></div></div>'
        : '') +
    '</div>';

  $('#back-btn').addEventListener('click', () => {
    window.history.back();
  });
}

// ── Init ──
window.addEventListener('hashchange', render);
render();
})();
