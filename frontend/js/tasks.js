/* ===== Задачи ===== */
const Tasks = {
  canManage() { return App.canAny(['admin', 'supervisor']); },

  statusBadge(status) {
    return `<span class="badge status-${status}">${App.statusLabel(status)}</span>`;
  },

  priorityLabel(p) {
    return { low: 'Низкий', normal: 'Обычный', high: 'Высокий' }[p] || p || '—';
  },

  async renderList(content, params = new URLSearchParams()) {
    content.innerHTML = '<div class="card">Загрузка задач…</div>';
    try {
      const projects = await API.projects();
      const projectFilter = params.get('project') || '';
      const statusFilter = params.get('status') || '';

      let query = '';
      const qs = [];
      if (projectFilter) qs.push(`project_id=${projectFilter}`);
      if (statusFilter) qs.push(`status=${statusFilter}`);
      if (qs.length) query = '?' + qs.join('&');

      const tasks = await API.tasks(query);

      const projectOptions = [
        '<option value="">Все проекты</option>',
        ...projects.map(p => `<option value="${p.id}" ${String(p.id) === projectFilter ? 'selected' : ''}>${App.esc(p.name)}</option>`),
      ].join('');

      const statuses = ['new', 'assigned', 'in_progress', 'on_review', 'rework', 'fixed', 'accepted', 'exported'];
      const statusOptions = [
        '<option value="">Все статусы</option>',
        ...statuses.map(s => `<option value="${s}" ${s === statusFilter ? 'selected' : ''}>${App.statusLabel(s)}</option>`),
      ].join('');

      const rows = tasks.length ? tasks.map(t => `
        <tr>
          <td class="clickable" onclick="App.navigate('/tasks/${t.id}')">#${t.id}</td>
          <td>${App.esc(t.project_name)}</td>
          <td>${App.esc(t.media_name || '—')}</td>
          <td>${App.esc(t.assignee_name || '—')}</td>
          <td>${App.esc(t.verifier_name || '—')}</td>
          <td>${this.statusBadge(t.status)}</td>
          <td>${this.priorityLabel(t.priority)}</td>
          <td>${t.segment_count}</td>
          <td>${App.fmtDuration(t.duration)}</td>
          <td style="white-space:nowrap">
            ${['assigned', 'in_progress', 'rework', 'fixed', 'new'].includes(t.status)
              ? `<button class="btn btn-sm" onclick="App.navigate('/tasks/work/${t.id}')">Разметка</button>` : ''}
            ${['on_review', 'fixed', 'accepted'].includes(t.status) || t.status === 'on_review'
              ? `<button class="btn btn-sm btn-yellow" onclick="App.navigate('/tasks/verify/${t.id}')">Проверка</button>` : ''}
            <button class="btn btn-sm btn-ghost" onclick="App.navigate('/tasks/${t.id}')">Детали</button>
          </td>
        </tr>`).join('') : '<tr><td colspan="10" style="color:var(--text-dim)">Задачи не найдены</td></tr>';

      content.innerHTML = `
        <div class="page-title-row">
          <div>
            <div class="page-title">Задачи</div>
            <div class="page-sub">Назначенные задачи и их статусы</div>
          </div>
          ${this.canManage() ? '<button class="btn" onclick="App.navigate(\'/tasks/new\')">＋ Новая задача</button>' : ''}
        </div>
        <div class="card">
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px">
            <select id="f-project" style="max-width:280px">${projectOptions}</select>
            <select id="f-status" style="max-width:200px">${statusOptions}</select>
            <button class="btn btn-ghost" onclick="Tasks.applyFilter()">Применить</button>
          </div>
          <table>
            <thead><tr><th>ID</th><th>Проект</th><th>Медиа</th><th>Разметчик</th><th>Верификатор</th><th>Статус</th><th>Приоритет</th><th>Сегм.</th><th>Длит.</th><th>Действия</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка загрузки задач: ${App.esc(e.message)}</div>`;
    }
  },

  applyFilter() {
    const p = document.getElementById('f-project').value;
    const s = document.getElementById('f-status').value;
    const qs = new URLSearchParams();
    if (p) qs.set('project', p);
    if (s) qs.set('status', s);
    App.navigate('/tasks' + (qs.toString() ? '?' + qs.toString() : ''));
  },

  async renderCreate(content, params = new URLSearchParams()) {
    if (!this.canManage()) {
      content.innerHTML = '<div class="card">Недостаточно прав для создания задачи.</div>';
      return;
    }
    content.innerHTML = '<div class="card">Загрузка…</div>';
    try {
      const projects = await API.projects();
      const users = await API.assignableUsers();
      const annotators = users.filter(u => u.role && u.role.name === 'annotator');
      const verifiers = users.filter(u => u.role && u.role.name === 'verifier');
      const presetProject = params.get('project') || '';

      const opt = (list, empty) => ['<option value="">' + empty + '</option>',
        ...list.map(u => `<option value="${u.id}">${App.esc(u.full_name)}</option>`)].join('');

      content.innerHTML = `
        <div class="page-title">Новая задача</div>
        <div class="page-sub">Создание задачи разметки с назначением исполнителя</div>
        <div class="card" style="max-width:720px">
          <form id="task-form">
            <div class="form-group"><label>Проект</label>
              <select id="t-project" required>
                ${projects.map(p => `<option value="${p.id}" ${String(p.id) === presetProject ? 'selected' : ''}>${App.esc(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Медиафайл</label>
              <select id="t-media"><option value="">— пока не выбран —</option></select>
              <div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap">
                <input type="file" id="t-upload" accept="audio/*,video/*" style="max-width:320px">
                <button type="button" class="btn btn-sm btn-ghost" onclick="Tasks.uploadMedia()">Загрузить файл</button>
              </div>
            </div>
            <div class="grid grid-3">
              <div class="form-group"><label>Разметчик</label><select id="t-assignee">${opt(annotators, 'Не назначен')}</select></div>
              <div class="form-group"><label>Верификатор</label><select id="t-verifier">${opt(verifiers, 'Не назначен')}</select></div>
              <div class="form-group"><label>Приоритет</label>
                <select id="t-priority"><option value="low">Низкий</option><option value="normal" selected>Обычный</option><option value="high">Высокий</option></select>
              </div>
            </div>
            <div class="form-group"><label>Дедлайн</label><input type="date" id="t-deadline"></div>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" onclick="App.navigate('/tasks')">Отмена</button>
              <button type="submit" class="btn btn-green">Создать задачу</button>
            </div>
          </form>
        </div>`;

      document.getElementById('t-project').addEventListener('change', () => this.loadMedia());
      document.getElementById('task-form').addEventListener('submit', e => this.submitCreate(e));
      await this.loadMedia(presetProject);
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка: ${App.esc(e.message)}</div>`;
    }
  },

  async loadMedia(projectId) {
    const pid = projectId || document.getElementById('t-project').value;
    try {
      const media = await API.mediaList(pid ? `?project_id=${pid}` : '');
      const sel = document.getElementById('t-media');
      if (!sel) return;
      sel.innerHTML = ['<option value="">— пока не выбран —</option>',
        ...media.map(m => `<option value="${m.id}">${App.esc(m.original_name)} (${m.format}, ${App.fmtDuration(m.duration)})</option>`)].join('');
    } catch (e) {
      /* медиа может быть недоступно — не блокируем создание */
    }
  },

  async uploadMedia() {
    const input = document.getElementById('t-upload');
    if (!input || !input.files.length) { toast('Выберите файл', 'error'); return; }
    const fd = new FormData();
    fd.append('file', input.files[0]);
    fd.append('project_id', document.getElementById('t-project').value);
    try {
      const media = await API.uploadMedia(fd);
      toast('Файл загружен', 'success');
      await this.loadMedia();
      document.getElementById('t-media').value = media.id;
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  async submitCreate(e) {
    e.preventDefault();
    const mediaId = document.getElementById('t-media').value;
    const assignee = document.getElementById('t-assignee').value;
    const verifier = document.getElementById('t-verifier').value;
    try {
      const task = await API.createTask({
        project_id: parseInt(document.getElementById('t-project').value),
        media_file_id: mediaId ? parseInt(mediaId) : null,
        assignee_id: assignee ? parseInt(assignee) : null,
        verifier_id: verifier ? parseInt(verifier) : null,
        priority: document.getElementById('t-priority').value,
        deadline: document.getElementById('t-deadline').value,
      });
      toast('Задача создана', 'success');
      App.navigate(`/tasks/${task.id}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async renderDetail(content, taskId) {
    content.innerHTML = '<div class="card">Загрузка задачи…</div>';
    try {
      const t = await API.task(taskId);
      const [segments, comments, exports, results] = await Promise.all([
        API.segments(taskId).catch(() => []),
        API.comments(taskId).catch(() => []),
        API.exports(taskId).catch(() => []),
        API.verificationResults(taskId).catch(() => []),
      ]);

      const role = App.user.role ? App.user.role.name : '';
      const manage = this.canManage();
      const withText = segments.filter(s => (s.text || '').trim()).length;
      const crosstalk = segments.filter(s => s.is_crosstalk).length;
      const openComments = comments.filter(c => c.status === 'open').length;

      const commentsHtml = comments.length ? comments.map(c => `
        <div class="comment">
          <div class="meta">${App.esc(c.author_name || 'Пользователь')} · ${App.fmtDate(c.created_at)}
            <span class="cat">${c.category === 'general' ? 'общее' : App.esc(c.category)}</span>
            ${c.status === 'open' && role !== 'customer' ? `<a style="float:right;color:var(--green);cursor:pointer" onclick="Tasks.resolveComment(${c.id}, ${taskId})">Закрыть</a>` : ''}
            ${c.status === 'resolved' ? '<span class="flag" style="float:right">закрыто</span>' : ''}
          </div>
          ${App.esc(c.text)}
        </div>`).join('') : '<p style="color:var(--text-dim)">Замечаний нет.</p>';

      const exportsHtml = exports.length ? exports.map(e => `
        <div class="segment-item">
          <span class="badge">${App.esc(e.format)}</span>
          <span class="text">${App.esc(e.path.split(/[\\/]/).pop())}</span>
          <button class="btn btn-sm btn-ghost" onclick="Tasks.downloadExport(${e.id}, '${App.esc(e.path.split(/[\\/]/).pop())}')">Скачать</button>
        </div>`).join('') : '<p style="color:var(--text-dim)">Экспортов пока нет.</p>';

      content.innerHTML = `
        <div class="page-title-row">
          <div>
            <div class="page-title">Задача #${t.id}</div>
            <div class="page-sub">${App.esc(t.project_name)} · ${App.esc(t.media_name || 'без медиа')}</div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            ${['assigned', 'in_progress', 'new', 'rework', 'fixed'].includes(t.status)
              ? `<button class="btn" onclick="App.navigate('/tasks/work/${t.id}')">🎧 Рабочее место</button>` : ''}
            ${['on_review', 'fixed'].includes(t.status)
              ? `<button class="btn btn-yellow" onclick="App.navigate('/tasks/verify/${t.id}')">✅ Проверка</button>` : ''}
          </div>
        </div>

        <div class="grid grid-4" style="margin-bottom:16px">
          <div class="stat"><div class="value" style="font-size:18px">${this.statusBadge(t.status)}</div><div class="label">Статус</div></div>
          <div class="stat"><div class="value">${segments.length}</div><div class="label">Сегментов (${withText} с текстом)</div></div>
          <div class="stat"><div class="value">${App.fmtDuration(t.duration)}</div><div class="label">Длительность</div></div>
          <div class="stat"><div class="value">${crosstalk}</div><div class="label">Кросстолков</div></div>
        </div>

        <div class="card">
          <h3>Сведения</h3>
          <div class="grid grid-3">
            <div><b>Разметчик:</b> ${App.esc(t.assignee_name || '—')}</div>
            <div><b>Верификатор:</b> ${App.esc(t.verifier_name || '—')}</div>
            <div><b>Приоритет:</b> ${this.priorityLabel(t.priority)}</div>
            <div><b>Дедлайн:</b> ${App.fmtDate(t.deadline)}</div>
            <div><b>Обновлено:</b> ${App.fmtDate(t.updated_at)}</div>
            <div><b>Открытых замечаний:</b> ${openComments}</div>
          </div>
          ${manage ? `
          <div style="margin-top:16px; display:flex; gap:8px; flex-wrap:wrap">
            <button class="btn btn-sm" onclick="Tasks.assignModal(${t.id})">Назначить исполнителей</button>
            <select id="status-change" style="max-width:220px">
              ${['new', 'assigned', 'in_progress', 'on_review', 'rework', 'fixed', 'accepted', 'exported']
                .map(s => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${App.statusLabel(s)}</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-ghost" onclick="Tasks.changeStatus(${t.id})">Сменить статус</button>
          </div>` : ''}
        </div>

        ${manage ? `
        <div class="card">
          <h3>Экспорт</h3>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px">
            <button class="btn btn-sm" onclick="Tasks.export(${t.id}, 'json')">Экспорт Gecko JSON</button>
            <button class="btn btn-sm btn-purple" onclick="Tasks.export(${t.id}, 'ml')">Экспорт для ML</button>
            <button class="btn btn-sm btn-ghost" onclick="Tasks.export(${t.id}, 'report')">Отчёт по качеству</button>
          </div>
          <div id="exports-list">${exportsHtml}</div>
        </div>` : ''}

        <div class="card">
          <h3>Замечания верификатора</h3>
          ${role !== 'customer' ? `
          <div style="display:flex; gap:8px; margin-bottom:12px">
            <input type="text" id="new-comment" placeholder="Добавить замечание…">
            <button class="btn" onclick="Tasks.addComment(${t.id})">Добавить</button>
          </div>` : ''}
          ${commentsHtml}
        </div>

        ${results.length ? `
        <div class="card">
          <h3>История проверок</h3>
          ${results.map(r => `<div class="segment-item"><span class="badge ${r.decision === 'accepted' ? 'status-accepted' : 'status-rework'}">${r.decision === 'accepted' ? 'Принято' : 'Возврат'}</span><span class="text">${App.esc(r.comment || '—')}</span><span class="time">${App.fmtDate(r.created_at)}</span></div>`).join('')}
        </div>` : ''}

        <div class="card">
          <h3>Сегменты (${segments.length})</h3>
          <div class="segment-list">
            ${segments.map(s => `
              <div class="segment-item clickable" onclick="App.navigate('/tasks/work/${t.id}')">
                <span class="time">${App.fmtTime(s.start_time)} – ${App.fmtTime(s.end_time)}</span>
                <span class="text ${((s.text || '').trim() ? '' : 'empty')}">${App.esc(s.text || '(без текста)')}</span>
                <span class="flags">
                  ${s.is_crosstalk ? '<span class="flag crosstalk">кросстолк</span>' : ''}
                  ${s.confidence < 0.6 ? '<span class="flag lowconf">low ASR</span>' : ''}
                </span>
              </div>`).join('') || '<p style="color:var(--text-dim)">Сегментов нет.</p>'}
          </div>
        </div>`;
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка: ${App.esc(e.message)}</div>`;
    }
  },

  async assignModal(taskId) {
    const t = await API.task(taskId);
    const users = await API.assignableUsers();
    const annotators = users.filter(u => u.role && u.role.name === 'annotator');
    const verifiers = users.filter(u => u.role && u.role.name === 'verifier');
    const opt = (list, sel) => ['<option value="">Не назначен</option>',
      ...list.map(u => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${App.esc(u.full_name)}</option>`)].join('');
    const modal = App.modal(`
      <h3>Назначение исполнителей</h3>
      <form id="assign-form">
        <div class="form-group"><label>Разметчик</label><select id="a-assignee">${opt(annotators, t.assignee_id)}</select></div>
        <div class="form-group"><label>Верификатор</label><select id="a-verifier">${opt(verifiers, t.verifier_id)}</select></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Отмена</button>
          <button type="submit" class="btn btn-green">Назначить</button>
        </div>
      </form>`);
    modal.querySelector('#assign-form').addEventListener('submit', async e => {
      e.preventDefault();
      const a = document.getElementById('a-assignee').value;
      const v = document.getElementById('a-verifier').value;
      try {
        await API.assignTask(taskId, { assignee_id: a ? parseInt(a) : null, verifier_id: v ? parseInt(v) : null });
        App.closeModal();
        toast('Исполнители назначены', 'success');
        App.render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  },

  async changeStatus(taskId) {
    const status = document.getElementById('status-change').value;
    try {
      await API.changeTaskStatus(taskId, status);
      toast('Статус обновлён', 'success');
      App.render();
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  async addComment(taskId) {
    const input = document.getElementById('new-comment');
    const text = input.value.trim();
    if (!text) return;
    try {
      await API.addComment(taskId, { task_id: taskId, text });
      toast('Замечание добавлено', 'success');
      App.render();
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  async resolveComment(commentId, taskId) {
    try {
      await API.resolveComment(commentId);
      toast('Замечание закрыто', 'success');
      App.render();
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  async export(taskId, kind) {
    try {
      if (kind === 'json') await API.exportJson(taskId);
      else if (kind === 'ml') await API.exportMl(taskId);
      else await API.exportReport(taskId);
      toast('Экспорт создан', 'success');
      App.render();
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  async downloadExport(id, filename) {
    try { await API.downloadExport(id, filename); }
    catch (e) { toast(e.message, 'error'); }
  },
};
