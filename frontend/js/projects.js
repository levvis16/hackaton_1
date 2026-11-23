/* ===== Проекты ===== */
const Projects = {
  canManage() { return App.canAny(['admin', 'supervisor']); },

  async renderList(content) {
    content.innerHTML = '<div class="card">Загрузка проектов…</div>';
    try {
      const projects = await API.projects();
      const manage = this.canManage();
      const header = `
        <div class="page-title-row">
          <div>
            <div class="page-title">Проекты</div>
            <div class="page-sub">Доступные проекты разметки и их прогресс</div>
          </div>
          ${manage ? '<button class="btn" onclick="App.navigate(\'/projects/new\')">＋ Новый проект</button>' : ''}
        </div>`;

      if (!projects || projects.length === 0) {
        content.innerHTML = header + '<div class="card">Проектов пока нет.</div>';
        return;
      }

      const cards = projects.map(p => {
        const done = p.accepted_count || 0;
        const total = p.task_count || 0;
        const pct = total ? Math.round(done / total * 100) : 0;
        return `
          <div class="project-card">
            <h3 class="clickable" onclick="App.navigate('/projects/${p.id}')">${App.esc(p.name)}</h3>
            <p>${App.esc(p.description || 'Без описания')}</p>
            <div class="project-meta">
              <span class="badge status-${p.status === 'archived' ? 'new' : 'accepted'}">${p.status === 'archived' ? 'Архив' : 'Активен'}</span>
              <span>Заказчик: ${App.esc(p.customer || '—')}</span>
              <span>Дедлайн: ${App.fmtDate(p.deadline)}</span>
            </div>
            <div style="margin:10px 0 6px; display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim)">
              <span>Задачи: ${done} / ${total}</span><span>${pct}%</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
            <div class="project-actions">
              <button class="btn btn-sm" onclick="App.navigate('/projects/${p.id}')">Открыть</button>
              <button class="btn btn-sm btn-purple" onclick="App.navigate('/tasks?project=${p.id}')">Задачи</button>
              <button class="btn btn-sm btn-ghost" onclick="App.navigate('/terms/${p.id}')">Термины</button>
            </div>
          </div>`;
      }).join('');

      content.innerHTML = header + `<div class="grid grid-2">${cards}</div>`;
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка загрузки проектов: ${App.esc(e.message)}</div>`;
    }
  },

  renderCreate(content) {
    if (!this.canManage()) {
      content.innerHTML = '<div class="card">Недостаточно прав для создания проекта.</div>';
      return;
    }
    content.innerHTML = `
      <div class="page-title">Новый проект</div>
      <div class="page-sub">Создание проекта разметки</div>
      <div class="card" style="max-width:640px">
        <form id="project-form">
          <div class="form-group"><label>Название</label><input type="text" id="p-name" required></div>
          <div class="form-group"><label>Описание</label><textarea id="p-desc"></textarea></div>
          <div class="form-group"><label>Заказчик</label><input type="text" id="p-customer"></div>
          <div class="form-group"><label>Дедлайн</label><input type="date" id="p-deadline"></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" onclick="App.navigate('/projects')">Отмена</button>
            <button type="submit" class="btn btn-green">Создать проект</button>
          </div>
        </form>
      </div>`;
    document.getElementById('project-form').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await API.createProject({
          name: document.getElementById('p-name').value.trim(),
          description: document.getElementById('p-desc').value.trim(),
          customer: document.getElementById('p-customer').value.trim(),
          deadline: document.getElementById('p-deadline').value,
        });
        toast('Проект создан', 'success');
        App.navigate('/projects');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  },

  async renderDetail(content, projectId) {
    content.innerHTML = '<div class="card">Загрузка…</div>';
    try {
      const project = await API.project(projectId);
      const tasks = await API.tasks(`?project_id=${projectId}`);
      const manage = this.canManage();

      const rows = tasks.length ? tasks.map(t => `
        <tr class="clickable" onclick="App.navigate('/tasks/${t.id}')">
          <td>#${t.id}</td>
          <td>${App.esc(t.media_name || 'без медиа')}</td>
          <td>${App.esc(t.assignee_name || '—')}</td>
          <td>${App.esc(t.verifier_name || '—')}</td>
          <td><span class="badge status-${t.status}">${App.statusLabel(t.status)}</span></td>
          <td>${t.segment_count}</td>
          <td>${App.fmtDuration(t.duration)}</td>
        </tr>`).join('') : '<tr><td colspan="7" style="color:var(--text-dim)">Задач пока нет</td></tr>';

      content.innerHTML = `
        <div class="page-title-row">
          <div>
            <div class="page-title">${App.esc(project.name)}</div>
            <div class="page-sub">Заказчик: ${App.esc(project.customer || '—')} · Дедлайн: ${App.fmtDate(project.deadline)}</div>
          </div>
          <div style="display:flex; gap:8px">
            <button class="btn btn-ghost" onclick="App.navigate('/terms/${projectId}')">Термины</button>
            <button class="btn btn-ghost" onclick="App.navigate('/analytics?project=${projectId}')">Аналитика</button>
            ${manage ? '<button class="btn" onclick="App.navigate(\'/tasks/new?project=' + projectId + '\')">＋ Задача</button>' : ''}
          </div>
        </div>
        <div class="card">
          <h3>Описание</h3>
          <p style="color:var(--text-dim)">${App.esc(project.description || 'Без описания')}</p>
          <div class="grid grid-3" style="margin-top:16px">
            <div class="stat"><div class="value">${project.task_count || 0}</div><div class="label">Всего задач</div></div>
            <div class="stat"><div class="value">${project.accepted_count || 0}</div><div class="label">Принято</div></div>
            <div class="stat"><div class="value">${project.status === 'archived' ? 'Архив' : 'Активен'}</div><div class="label">Статус</div></div>
          </div>
          ${manage ? `
          <div style="margin-top:16px; display:flex; gap:8px; flex-wrap:wrap">
            <button class="btn btn-sm" onclick="Projects.editModal(${project.id})">Редактировать</button>
            ${App.can('admin') ? `<button class="btn btn-sm btn-red" onclick="Projects.archive(${project.id})">Архивировать</button>` : ''}
          </div>` : ''}
        </div>
        <div class="card">
          <h3>Задачи проекта</h3>
          <table>
            <thead><tr><th>ID</th><th>Медиа</th><th>Разметчик</th><th>Верификатор</th><th>Статус</th><th>Сегментов</th><th>Длительность</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка: ${App.esc(e.message)}</div>`;
    }
  },

  async editModal(projectId) {
    const project = await API.project(projectId);
    const modal = App.modal(`
      <h3>Редактирование проекта</h3>
      <form id="edit-project-form">
        <div class="form-group"><label>Название</label><input type="text" id="ep-name" value="${App.esc(project.name)}" required></div>
        <div class="form-group"><label>Описание</label><textarea id="ep-desc">${App.esc(project.description || '')}</textarea></div>
        <div class="form-group"><label>Заказчик</label><input type="text" id="ep-customer" value="${App.esc(project.customer || '')}"></div>
        <div class="form-group"><label>Дедлайн</label><input type="date" id="ep-deadline" value="${App.esc(project.deadline || '')}"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Отмена</button>
          <button type="submit" class="btn btn-green">Сохранить</button>
        </div>
      </form>`);
    modal.querySelector('#edit-project-form').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await API.updateProject(projectId, {
          name: document.getElementById('ep-name').value.trim(),
          description: document.getElementById('ep-desc').value.trim(),
          customer: document.getElementById('ep-customer').value.trim(),
          deadline: document.getElementById('ep-deadline').value,
        });
        App.closeModal();
        toast('Проект обновлён', 'success');
        App.render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  },

  async archive(projectId) {
    if (!confirm('Архивировать проект?')) return;
    try {
      await API.deleteProject(projectId);
      toast('Проект архивирован', 'success');
      App.navigate('/projects');
    } catch (e) {
      toast(e.message, 'error');
    }
  },
};
