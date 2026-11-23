/* ===== Аналитика и отчётность ===== */
const Analytics = {
  async render(content, params = new URLSearchParams()) {
    content.innerHTML = '<div class="card">Загрузка аналитики…</div>';
    try {
      const projects = await API.projects();
      const projectId = params.get('project') || (projects[0] ? String(projects[0].id) : '');
      const canUsers = App.canAny(['admin', 'supervisor']);

      const header = `
        <div class="page-title-row">
          <div>
            <div class="page-title">Аналитика</div>
            <div class="page-sub">Метрики по проектам, исполнителям и качеству</div>
          </div>
          <select id="an-project" style="max-width:300px" onchange="Analytics.switchProject(this.value)">
            ${projects.map(p => `<option value="${p.id}" ${String(p.id) === projectId ? 'selected' : ''}>${App.esc(p.name)}</option>`).join('')}
          </select>
        </div>`;

      if (!projectId) {
        content.innerHTML = header + '<div class="card">Нет доступных проектов.</div>';
        return;
      }

      const an = await API.projectAnalytics(projectId);
      const terms = an.terms || {};
      const byStatus = an.by_status || {};

      const statusRows = Object.entries(byStatus).map(([k, v]) => `
        <div class="segment-item"><span class="badge status-${k}">${App.statusLabel(k)}</span><span class="text"></span><span class="time">${v}</span></div>`).join('') || '<p style="color:var(--text-dim)">Нет данных</p>';

      content.innerHTML = header + `
        <div class="grid grid-4" style="margin-bottom:16px">
          <div class="stat"><div class="value">${an.total_tasks}</div><div class="label">Всего задач</div></div>
          <div class="stat"><div class="value">${an.processed_tasks}</div><div class="label">Обработано</div></div>
          <div class="stat"><div class="value">${an.accepted_tasks}</div><div class="label">Принято</div></div>
          <div class="stat"><div class="value">${an.rework_tasks}</div><div class="label">На доработке</div></div>
        </div>
        <div class="grid grid-4" style="margin-bottom:16px">
          <div class="stat"><div class="value">${App.fmtDuration(an.total_duration)}</div><div class="label">Длительность аудио</div></div>
          <div class="stat"><div class="value">${an.total_segments}</div><div class="label">Сегментов</div></div>
          <div class="stat"><div class="value">${an.total_edits}</div><div class="label">Исправлений</div></div>
          <div class="stat"><div class="value">${an.total_comments}</div><div class="label">Замечаний</div></div>
        </div>

        <div class="grid grid-2">
          <div class="card">
            <h3>Прогресс проекта</h3>
            <div style="display:flex; justify-content:space-between; margin-bottom:6px"><span>Выполнение</span><b>${an.progress}%</b></div>
            <div class="progress-bar"><div class="progress-fill" style="width:${an.progress}%"></div></div>
            <div style="display:flex; justify-content:space-between; margin:16px 0 6px"><span>Процент возвратов</span><b>${an.return_rate}%</b></div>
            <div class="progress-bar"><div class="progress-fill" style="width:${an.return_rate}%; background:var(--red)"></div></div>
          </div>
          <div class="card">
            <h3>Статистика по терминам</h3>
            <div class="grid grid-3">
              <div class="stat"><div class="value">${terms.total || 0}</div><div class="label">Всего</div></div>
              <div class="stat"><div class="value" style="color:var(--yellow)">${terms.new || 0}</div><div class="label">Новые</div></div>
              <div class="stat"><div class="value" style="color:var(--green)">${terms.approved || 0}</div><div class="label">Подтверждённые</div></div>
            </div>
            <div style="margin-top:12px; display:flex; gap:8px">
              <button class="btn btn-sm btn-ghost" onclick="App.navigate('/terms/${projectId}')">Открыть термины</button>
            </div>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card">
            <h3>Задачи по статусам</h3>
            ${statusRows}
          </div>
          <div class="card">
            <h3>Исполнители проекта</h3>
            <div id="an-users"></div>
          </div>
        </div>

        <div class="card">
          <h3>Рейтинг качества исполнителей</h3>
          <div id="an-quality"></div>
        </div>`;

      this.renderProjectUsers(an.by_user || []);
      if (canUsers) this.renderUserQuality();
      else document.getElementById('an-quality').innerHTML = '<p style="color:var(--text-dim)">Доступно супервайзеру и администратору.</p>';
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка: ${App.esc(e.message)}</div>`;
    }
  },

  switchProject(id) { App.navigate('/analytics?project=' + id); },

  async renderProjectUsers(byUser) {
    const el = document.getElementById('an-users');
    if (!byUser.length) { el.innerHTML = '<p style="color:var(--text-dim)">Нет данных</p>'; return; }
    el.innerHTML = `
      <table>
        <thead><tr><th>Пользователь</th><th>Задачи</th><th>Принято</th><th>Длит.</th></tr></thead>
        <tbody>${byUser.map(u => `<tr><td>#${u.user_id}</td><td>${u.tasks}</td><td>${u.accepted}</td><td>${App.fmtDuration(u.duration)}</td></tr>`).join('')}</tbody>
      </table>`;
  },

  async renderUserQuality() {
    const el = document.getElementById('an-quality');
    try {
      const users = await API.usersAnalytics();
      const relevant = users.filter(u => u.tasks_total > 0);
      el.innerHTML = relevant.length ? `
        <table>
          <thead><tr><th>Исполнитель</th><th>Роль</th><th>Задачи</th><th>Принято</th><th>Возвраты</th><th>Исправлений</th><th>Длительность</th><th>Качество</th></tr></thead>
          <tbody>${relevant.map(u => `
            <tr>
              <td>${App.esc(u.full_name)}</td>
              <td>${App.roleLabel(u.role)}</td>
              <td>${u.tasks_total}</td>
              <td>${u.tasks_accepted}</td>
              <td>${u.tasks_returned}</td>
              <td>${u.edits}</td>
              <td>${App.fmtDuration(u.duration_seconds)}</td>
              <td>
                <span class="badge ${u.quality_score >= 80 ? 'status-accepted' : u.quality_score >= 50 ? 'status-in_progress' : 'status-rework'}">${u.quality_score}%</span>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>` : '<p style="color:var(--text-dim)">Нет данных по исполнителям.</p>';
    } catch (e) {
      el.innerHTML = `<p style="color:var(--text-dim)">Недоступно: ${App.esc(e.message)}</p>`;
    }
  },
};
