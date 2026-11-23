/* ===== Административная панель ===== */
const Admin = {
  tab: 'users',
  users: [],
  roles: [],

  async render(content) {
    if (!App.can('admin')) {
      content.innerHTML = '<div class="card">Доступно только администратору.</div>';
      return;
    }
    content.innerHTML = '<div class="card">Загрузка панели администрирования…</div>';
    try {
      const [users, roles] = await Promise.all([API.adminUsers(), API.roles()]);
      this.users = users; this.roles = roles;
      content.innerHTML = `
        <div class="page-title-row">
          <div>
            <div class="page-title">Администрирование</div>
            <div class="page-sub">Пользователи, роли, аудит действий и история назначений</div>
          </div>
          <button class="btn" onclick="Admin.userModal()">＋ Пользователь</button>
        </div>
        <div class="card">
          <div class="tabs">
            <div class="tab active" data-tab="users" onclick="Admin.showTab('users')">👥 Пользователи</div>
            <div class="tab" data-tab="audit" onclick="Admin.showTab('audit')">📜 Аудит</div>
            <div class="tab" data-tab="assign" onclick="Admin.showTab('assign')">🗂 Назначения</div>
          </div>
          <div id="admin-body"></div>
        </div>`;
      this.showTab(this.tab);
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка: ${App.esc(e.message)}</div>`;
    }
  },

  showTab(name) {
    this.tab = name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    if (name === 'users') this.renderUsers();
    else if (name === 'audit') this.renderAudit();
    else this.renderAssignments();
  },

  renderUsers() {
    document.getElementById('admin-body').innerHTML = `
      <table>
        <thead><tr><th>ID</th><th>ФИО</th><th>Email</th><th>Роль</th><th>Статус</th><th>Действия</th></tr></thead>
        <tbody>${this.users.map(u => `
          <tr>
            <td>${u.id}</td>
            <td>${App.esc(u.full_name)}</td>
            <td>${App.esc(u.email)}</td>
            <td>${App.roleLabel(u.role ? u.role.name : '')}</td>
            <td><span class="badge ${u.status === 'active' ? 'status-accepted' : 'status-rework'}">${u.status === 'active' ? 'Активен' : 'Заблокирован'}</span></td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm btn-ghost" onclick="Admin.userModal(${u.id})">✎</button>
              <button class="btn btn-sm ${u.status === 'active' ? 'btn-red' : 'btn-green'}" onclick="Admin.toggleBlock(${u.id}, '${u.status}')">
                ${u.status === 'active' ? 'Блок' : 'Разблок'}
              </button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  },

  userModal(id) {
    const u = id ? this.users.find(z => z.id === id) : null;
    const modal = App.modal(`
      <h3>${u ? 'Пользователь: ' + App.esc(u.full_name) : 'Новый пользователь'}</h3>
      <form id="user-form">
        <div class="form-group"><label>ФИО</label><input type="text" id="u-name" value="${u ? App.esc(u.full_name) : ''}" required></div>
        <div class="form-group"><label>Email</label><input type="email" id="u-email" value="${u ? App.esc(u.email) : ''}" ${u ? 'disabled' : 'required'}></div>
        <div class="form-group"><label>Роль</label>
          <select id="u-role">
            ${this.roles.map(r => `<option value="${r.id}" ${u && u.role_id === r.id ? 'selected' : ''}>${App.esc(r.label)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Пароль ${u ? '(оставьте пустым, чтобы не менять)' : ''}</label><input type="password" id="u-password" ${u ? '' : 'minlength="6" required'}></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Отмена</button>
          <button type="submit" class="btn btn-green">Сохранить</button>
        </div>
      </form>`);
    modal.querySelector('#user-form').addEventListener('submit', async e => {
      e.preventDefault();
      const password = document.getElementById('u-password').value;
      try {
        if (u) {
          await API.adminUpdateUser(u.id, {
            full_name: document.getElementById('u-name').value.trim(),
            role_id: parseInt(document.getElementById('u-role').value),
            ...(password ? { password } : {}),
          });
        } else {
          await API.adminCreateUser({
            full_name: document.getElementById('u-name').value.trim(),
            email: document.getElementById('u-email').value.trim(),
            password,
            role: this.roles.find(r => r.id === parseInt(document.getElementById('u-role').value)).name,
          });
        }
        App.closeModal();
        toast('Сохранено', 'success');
        App.render();
      } catch (err) { toast(err.message, 'error'); }
    });
  },

  async toggleBlock(id, current) {
    try {
      await API.adminUpdateUser(id, { status: current === 'active' ? 'blocked' : 'active' });
      toast('Статус пользователя обновлён', 'success');
      App.render();
    } catch (e) { toast(e.message, 'error'); }
  },

  async renderAudit() {
    const body = document.getElementById('admin-body');
    body.innerHTML = 'Загрузка…';
    try {
      const entries = await API.audit();
      body.innerHTML = entries.length ? `
        <table>
          <thead><tr><th>Время</th><th>Пользователь</th><th>Объект</th><th>Действие</th><th>Было</th><th>Стало</th></tr></thead>
          <tbody>${entries.map(e => `
            <tr>
              <td style="white-space:nowrap">${App.fmtDate(e.created_at)}</td>
              <td>${App.esc(e.user_name || '—')}</td>
              <td>${App.esc(e.entity_type)} #${e.entity_id ?? ''}</td>
              <td>${App.esc(e.action)}</td>
              <td style="max-width:220px; color:var(--text-dim)">${App.esc(String(e.old_value || '').slice(0, 80))}</td>
              <td style="max-width:220px">${App.esc(String(e.new_value || '').slice(0, 80))}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : '<p style="color:var(--text-dim)">Журнал пуст.</p>';
    } catch (e) {
      body.innerHTML = `<p style="color:var(--red)">Ошибка: ${App.esc(e.message)}</p>`;
    }
  },

  async renderAssignments() {
    const body = document.getElementById('admin-body');
    body.innerHTML = 'Загрузка…';
    try {
      const entries = await API.assignmentHistory();
      body.innerHTML = entries.length ? `
        <table>
          <thead><tr><th>Время</th><th>Задача</th><th>Разметчик</th><th>Верификатор</th><th>Действие</th></tr></thead>
          <tbody>${entries.map(e => `
            <tr>
              <td style="white-space:nowrap">${App.fmtDate(e.created_at)}</td>
              <td>#${e.task_id}</td>
              <td>${e.assignee_id ?? '—'}</td>
              <td>${e.verifier_id ?? '—'}</td>
              <td>${App.esc(e.action)}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : '<p style="color:var(--text-dim)">История назначений пуста.</p>';
    } catch (e) {
      body.innerHTML = `<p style="color:var(--red)">Ошибка: ${App.esc(e.message)}</p>`;
    }
  },
};
