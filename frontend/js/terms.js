/* ===== Терминологический модуль ===== */
const Terms = {
  projectId: null,
  items: [],
  search: '',
  statusFilter: '',

  async render(content, projectId) {
    if (!projectId) { return this.renderPicker(content); }
    this.projectId = projectId;
    content.innerHTML = '<div class="card">Загрузка терминов…</div>';
    try {
      const [project, terms] = await Promise.all([API.project(projectId), API.terms(projectId)]);
      this.items = terms;
      content.innerHTML = `
        <div class="page-title-row">
          <div>
            <div class="page-title">Термины проекта</div>
            <div class="page-sub">${App.esc(project.name)} · управление спорными и подтверждёнными терминами</div>
          </div>
          <div style="display:flex; gap:8px">
            <button class="btn btn-ghost" onclick="App.navigate('/projects/${projectId}')">← Проект</button>
            <button class="btn btn-ghost" onclick="Terms.importModal()">⬆ Импорт словаря</button>
            <button class="btn btn-ghost" onclick="Terms.exportList()">⬇ Экспорт списка</button>
            <button class="btn" onclick="Terms.editModal()">＋ Термин</button>
          </div>
        </div>
        <div class="grid grid-4" id="terms-stats" style="margin-bottom:16px"></div>
        <div class="card">
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px">
            <input type="text" id="t-search" placeholder="Поиск по терминам…" style="max-width:300px" value="${App.esc(this.search)}">
            <select id="t-status" style="max-width:200px">
              <option value="">Все статусы</option>
              <option value="new">Новые</option>
              <option value="on_review">На проверке</option>
              <option value="approved">Подтверждённые</option>
              <option value="rejected">Отклонённые</option>
            </select>
            <button class="btn btn-ghost" onclick="Terms.applyFilter()">Фильтр</button>
          </div>
          <div id="terms-table"></div>
        </div>`;

      document.getElementById('t-search').addEventListener('keydown', e => { if (e.key === 'Enter') this.applyFilter(); });
      document.getElementById('t-status').value = this.statusFilter;
      this.renderStats();
      this.renderTable();
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка: ${App.esc(e.message)}</div>`;
    }
  },

  async renderPicker(content) {
    content.innerHTML = '<div class="card">Загрузка…</div>';
    try {
      const projects = await API.projects();
      content.innerHTML = `
        <div class="page-title">Термины</div>
        <div class="page-sub">Выберите проект для работы со словарём терминов</div>
        <div class="grid grid-3">
          ${projects.map(p => `
            <div class="project-card clickable" onclick="App.navigate('/terms/${p.id}')">
              <h3>${App.esc(p.name)}</h3>
              <p>${App.esc(p.customer || '')}</p>
            </div>`).join('') || '<div class="card">Проектов нет.</div>'}
        </div>`;
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка: ${App.esc(e.message)}</div>`;
    }
  },

  applyFilter() {
    this.search = document.getElementById('t-search').value.trim().toLowerCase();
    this.statusFilter = document.getElementById('t-status').value;
    this.renderTable();
  },

  filtered() {
    return this.items.filter(t =>
      (!this.statusFilter || t.status === this.statusFilter) &&
      (!this.search || t.value.toLowerCase().includes(this.search))
    );
  },

  renderStats() {
    const el = document.getElementById('terms-stats');
    if (!el) return;
    const c = { total: this.items.length, new: 0, on_review: 0, approved: 0, rejected: 0 };
    this.items.forEach(t => { if (c[t.status] !== undefined) c[t.status]++; });
    el.innerHTML = `
      <div class="stat"><div class="value">${c.total}</div><div class="label">Всего терминов</div></div>
      <div class="stat"><div class="value">${c.new}</div><div class="label">Новые</div></div>
      <div class="stat"><div class="value">${c.approved}</div><div class="label">Подтверждённые</div></div>
      <div class="stat"><div class="value">${c.rejected}</div><div class="label">Отклонённые</div></div>`;
  },

  renderTable() {
    const el = document.getElementById('terms-table');
    if (!el) return;
    const list = this.filtered();
    const canApprove = App.canAny(['admin', 'supervisor', 'verifier']);
    el.innerHTML = list.length ? `
      <table>
        <thead><tr><th>Термин</th><th>Тип</th><th>Статус</th><th>Вариант</th><th>Комментарий</th><th>Действия</th></tr></thead>
        <tbody>${list.map(t => `
          <tr>
            <td><b>${App.esc(t.value)}</b></td>
            <td>${App.esc(t.type)}</td>
            <td><span class="badge term-${t.status}">${App.termStatusLabel(t.status)}</span></td>
            <td>${App.esc(t.suggested_variant || '—')}</td>
            <td style="max-width:280px">${App.esc(t.comment || '—')}</td>
            <td style="white-space:nowrap">
              ${canApprove ? `
                <button class="btn btn-sm btn-green" onclick="Terms.decide(${t.id}, 'approve')" title="Подтвердить">✓</button>
                <button class="btn btn-sm btn-red" onclick="Terms.decide(${t.id}, 'reject')" title="Отклонить">✕</button>` : ''}
              <button class="btn btn-sm btn-ghost" onclick="Terms.editModal(${t.id})">✎</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p style="color:var(--text-dim)">Термины не найдены.</p>';
  },

  async decide(id, action) {
    try {
      const updated = action === 'approve' ? await API.approveTerm(id) : await API.rejectTerm(id);
      const idx = this.items.findIndex(t => t.id === id);
      if (idx !== -1) this.items[idx] = updated;
      this.renderStats(); this.renderTable();
      toast(action === 'approve' ? 'Термин подтверждён' : 'Термин отклонён', 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  editModal(id) {
    const t = id ? this.items.find(z => z.id === id) : null;
    const modal = App.modal(`
      <h3>${t ? 'Редактирование термина' : 'Новый термин'}</h3>
      <form id="term-form">
        <div class="form-group"><label>Термин</label><input type="text" id="f-value" value="${t ? App.esc(t.value) : ''}" required></div>
        <div class="form-group"><label>Тип</label>
          <select id="f-type">
            ${['term', 'abbreviation', 'disputed', 'unknown'].map(x => `<option value="${x}" ${t && t.type === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Нормализованный вариант</label><input type="text" id="f-variant" value="${t ? App.esc(t.suggested_variant || '') : ''}"></div>
        <div class="form-group"><label>Комментарий</label><textarea id="f-comment">${t ? App.esc(t.comment || '') : ''}</textarea></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Отмена</button>
          <button type="submit" class="btn btn-green">Сохранить</button>
        </div>
      </form>`);
    modal.querySelector('#term-form').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        project_id: this.projectId,
        value: document.getElementById('f-value').value.trim(),
        type: document.getElementById('f-type').value,
        suggested_variant: document.getElementById('f-variant').value.trim(),
        comment: document.getElementById('f-comment').value.trim(),
      };
      try {
        if (t) {
          const updated = await API.updateTerm(t.id, payload);
          const idx = this.items.findIndex(z => z.id === t.id);
          if (idx !== -1) this.items[idx] = updated;
        } else {
          const created = await API.createTerm(payload);
          this.items.unshift(created);
        }
        App.closeModal();
        this.renderStats(); this.renderTable();
        toast('Сохранено', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
  },

  importModal() {
    const modal = App.modal(`
      <h3>Импорт словаря терминов</h3>
      <p style="color:var(--text-dim); margin-bottom:12px">Поддерживается JSON-массив или txt (по одному термину на строку).</p>
      <div class="form-group"><input type="file" id="f-term-file" accept=".json,.txt"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="App.closeModal()">Отмена</button>
        <button class="btn btn-green" onclick="Terms.doImport()">Импортировать</button>
      </div>`);
  },

  async doImport() {
    const input = document.getElementById('f-term-file');
    if (!input.files.length) { toast('Выберите файл', 'error'); return; }
    const fd = new FormData();
    fd.append('file', input.files[0]);
    try {
      const res = await API.importTerms(this.projectId, fd);
      App.closeModal();
      toast(`Импортировано терминов: ${res.imported}`, 'success');
      App.render();
    } catch (e) { toast(e.message, 'error'); }
  },

  async exportList() {
    try {
      const res = await API.exportTerms(this.projectId);
      await API.downloadTermsExport(this.projectId);
      toast(`Экспортировано терминов: ${res.count}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  },
};
