/* ===== Ядро SPA: роутер, навигация, утилиты ===== */
const App = {
  user: null,

  async init() {
    const token = API.token();
    if (token) {
      try {
        this.user = await API.me();
      } catch (e) {
        API.clearToken();
      }
    }
    this.render();
    window.addEventListener('hashchange', () => this.render());
  },

  navigate(path) {
    window.location.hash = path;
  },

  logout(silent) {
    API.clearToken();
    this.user = null;
    if (!silent) toast('Вы вышли из системы', 'info');
    this.navigate('/login');
  },

  render() {
    const authView = document.getElementById('auth-view');
    const mainView = document.getElementById('main-view');
    const hash = window.location.hash || '#/';

    if (!this.user) {
      authView.classList.remove('hidden');
      mainView.classList.add('hidden');
      Auth.render(hash);
      return;
    }
    authView.classList.add('hidden');
    mainView.classList.remove('hidden');
    this.renderTopbar();
    this.renderRoute(hash);
  },

  renderTopbar() {
    const u = this.user;
    document.getElementById('user-name').textContent = u.full_name;
    const roleBadge = document.getElementById('user-role');
    roleBadge.textContent = App.roleLabel(u.role ? u.role.name : '');
    roleBadge.className = `badge ${u.role ? u.role.name : ''}`;

    const nav = document.getElementById('main-nav');
    const items = [
      { path: '/', label: '🏠 Главная', roles: ['admin', 'supervisor', 'annotator', 'verifier', 'ml_engineer', 'customer'] },
      { path: '/projects', label: '📁 Проекты', roles: ['admin', 'supervisor', 'annotator', 'verifier', 'ml_engineer', 'customer'] },
      { path: '/tasks', label: '📋 Задачи', roles: ['admin', 'supervisor', 'annotator', 'verifier'] },
      { path: '/analytics', label: '📊 Аналитика', roles: ['admin', 'supervisor', 'ml_engineer', 'customer'] },
      { path: '/admin', label: '⚙️ Администрирование', roles: ['admin'] },
    ];
    const role = u.role ? u.role.name : '';
    const hash = window.location.hash || '#/';
    nav.innerHTML = items
      .filter(i => i.roles.includes(role))
      .map(i => {
        const active = hash.startsWith(i.path) && i.path !== '/' ? 'active' : (hash === '#/' && i.path === '/' ? 'active' : '');
        return `<a href="#${i.path}" class="${active}">${i.label}</a>`;
      })
      .join('');
  },

  renderRoute(hash) {
    const content = document.getElementById('content');
    const [pathPart, queryPart] = hash.replace(/^#/, '').split('?');
    const params = new URLSearchParams(queryPart || '');
    const parts = pathPart.split('/').filter(Boolean);

    if (parts.length === 0) {
      Dashboard.render(content);
    } else if (parts[0] === 'projects') {
      if (parts.length === 1) Projects.renderList(content);
      else if (parts[1] === 'new') Projects.renderCreate(content);
      else Projects.renderDetail(content, parseInt(parts[1]));
    } else if (parts[0] === 'tasks') {
      if (parts.length === 1) Tasks.renderList(content, params);
      else if (parts[1] === 'new') Tasks.renderCreate(content, params);
      else if (parts[1] === 'work') Annotator.render(content, parseInt(parts[2]));
      else if (parts[1] === 'verify') Verifier.render(content, parseInt(parts[2]));
      else Tasks.renderDetail(content, parseInt(parts[1]));
    } else if (parts[0] === 'terms') {
      Terms.render(content, parts[1] ? parseInt(parts[1]) : null);
    } else if (parts[0] === 'analytics') {
      Analytics.render(content, params);
    } else if (parts[0] === 'admin') {
      Admin.render(content);
    } else {
      content.innerHTML = '<h2>Страница не найдена</h2>';
    }
  },

  // утилиты
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  },

  fmtTime(t) {
    if (t === null || t === undefined || isNaN(t)) return '0:00.00';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  },

  fmtDuration(sec) {
    if (!sec) return '0 мин';
    if (sec < 60) return `${Math.round(sec)} с`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    return `${h} ч ${m % 60} мин`;
  },

  statusLabel(s) {
    return { new: 'Новая', assigned: 'Назначена', in_progress: 'В работе', on_review: 'На проверке', rework: 'На доработке', fixed: 'Исправлена', accepted: 'Принята', exported: 'Выгружена' }[s] || s;
  },

  termStatusLabel(s) {
    return { new: 'Новый', on_review: 'На проверке', approved: 'Подтверждён', rejected: 'Отклонён' }[s] || s;
  },

  roleLabel(r) {
    return { admin: 'Администратор', supervisor: 'Супервайзер', annotator: 'Разметчик', verifier: 'Верификатор', ml_engineer: 'ML-инженер', customer: 'Заказчик' }[r] || r;
  },

  can(role) {
    return this.user && this.user.role && this.user.role.name === role;
  },

  canAny(roles) {
    return this.user && this.user.role && roles.includes(this.user.role.name);
  },

  modal(html) {
    const div = document.createElement('div');
    div.className = 'modal-backdrop';
    div.innerHTML = `<div class="modal">${html}</div>`;
    div.addEventListener('click', e => { if (e.target === div) div.remove(); });
    document.body.appendChild(div);
    return div;
  },

  closeModal() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
  },

  download(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  toast(message, type = 'info') {
    toast(message, type);
  },

  fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('ru-RU');
  },
};

function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ===== Дашборд ===== */
const Dashboard = {
  async render(content) {
    const u = App.user;
    const role = u.role ? u.role.name : '';
    let html = `
      <div class="page-title">Добро пожаловать, ${App.esc(u.full_name)}!</div>
      <div class="page-sub">Роль: ${App.roleLabel(role)} · Gecko Next — сервис аудио/видеоразметки</div>
    `;

    if (role === 'annotator' || role === 'verifier' || role === 'supervisor' || role === 'admin') {
      try {
        const tasks = await API.tasks();
        const byStatus = {};
        tasks.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
        const inProgress = tasks.filter(t => t.status === 'in_progress' || t.status === 'assigned').length;
        const onReview = tasks.filter(t => t.status === 'on_review').length;
        const rework = tasks.filter(t => t.status === 'rework').length;

        html += `
          <div class="grid grid-4" style="margin-bottom:20px">
            <div class="stat"><div class="value">${tasks.length}</div><div class="label">Всего задач</div></div>
            <div class="stat"><div class="value">${inProgress}</div><div class="label">В работе</div></div>
            <div class="stat"><div class="value">${onReview}</div><div class="label">На проверке</div></div>
            <div class="stat"><div class="value">${rework}</div><div class="label">На доработке</div></div>
          </div>
          <div class="card">
            <h3>Мои задачи</h3>
            <div id="dash-tasks"></div>
          </div>
        `;
        content.innerHTML = html;
        const el = document.getElementById('dash-tasks');
        if (tasks.length === 0) {
          el.innerHTML = '<p style="color:var(--text-dim)">Задач пока нет.</p>';
        } else {
          el.innerHTML = tasks.slice(0, 8).map(t => `
            <div class="segment-item clickable" onclick="App.navigate('/tasks/work/${t.id}')">
              <span class="badge status-${t.status}">${App.statusLabel(t.status)}</span>
              <span class="text"><b>${App.esc(t.project_name)}</b> — ${App.esc(t.media_name || 'без медиа')}</span>
              <span class="time">${App.fmtDuration(t.duration)}</span>
            </div>
          `).join('');
        }
      } catch (e) {
        content.innerHTML = `<div class="card">Ошибка загрузки: ${App.esc(e.message)}</div>`;
      }
    } else {
      html += `
        <div class="card">
          <h3>Быстрый старт</h3>
          <p style="color:var(--text-dim); margin-bottom:16px">
            Загрузите аудио и JSON-предразметку, исправьте сегменты и текст, отправьте на проверку верификатору.
          </p>
          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <button class="btn" onclick="App.navigate('/projects')">📁 Проекты</button>
            <button class="btn btn-green" onclick="App.navigate('/tasks')">📋 Задачи</button>
          </div>
        </div>
      `;
      content.innerHTML = html;
    }
  },
};
