/* ===== Рабочее место верификатора ===== */
const Verifier = {
  s: null,

  async render(content, taskId) {
    content.innerHTML = '<div class="card">Загрузка кабинета верификатора…</div>';
    this.s = { taskId, task: null, segments: [], activeId: null, source: [], edits: [], comments: [], results: [], tab: 'compare' };
    const s = this.s;
    try {
      const task = s.task = await API.task(taskId);
      s.segments = await API.segments(taskId);
      content.innerHTML = this.layout(task);
      this.initAudio();
      this.renderList();
      this.selectSegment(s.segments[0] ? s.segments[0].id : null);
      await this.load();
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка: ${App.esc(e.message)}</div>`;
    }
  },

  layout(task) {
    const s = this.s;
    const canVerify = ['on_review', 'fixed'].includes(task.status);
    return `
      <div class="workspace">
        <div class="ws-topbar">
          <button class="btn btn-sm btn-ghost" onclick="App.navigate('/tasks/${task.id}')">← Назад</button>
          <span class="title">Проверка задачи #${task.id}</span>
          <span class="badge status-${task.status}">${App.statusLabel(task.status)}</span>
          <span style="color:var(--text-dim)">${App.esc(task.project_name)} · ${App.esc(task.media_name || 'без медиа')}</span>
          <div style="flex:1"></div>
          <button class="btn btn-sm btn-yellow" onclick="Verifier.returnModal()" ${canVerify ? '' : 'disabled'}>↩ Вернуть на доработку</button>
          <button class="btn btn-sm btn-green" onclick="Verifier.acceptModal()" ${canVerify ? '' : 'disabled'}>✓ Принять</button>
        </div>
        <div class="ws-body">
          <div class="ws-left">
            <div class="waveform-wrap">
              <div class="waveform-scroll" id="wf-scroll"><canvas id="waveform-canvas"></canvas></div>
              <div class="waveform-toolbar">
                <button class="btn btn-sm" id="v-play" onclick="Verifier.togglePlay()">▶</button>
                <button class="btn btn-sm btn-purple" onclick="Verifier.playSegment()">▶ Play Segment</button>
                <span style="flex:1"></span>
                <span class="time-display" id="time-display">0:00.00 / ${App.fmtTime(task.duration)}</span>
              </div>
              <audio id="ws-audio" preload="auto" hidden></audio>
            </div>
            <div class="card">
              <div class="tabs">
                <div class="tab active" data-tab="compare" onclick="Verifier.showTab('compare')">⇄ Сравнение</div>
                <div class="tab" data-tab="segments" onclick="Verifier.showTab('segments')">📋 Сегменты</div>
                <div class="tab" data-tab="history" onclick="Verifier.showTab('history')">🕘 История правок</div>
              </div>
              <div id="tab-body"></div>
            </div>
          </div>
          <div class="ws-right">
            <div class="card" style="padding:14px">
              <h3>Замечания верификатора</h3>
              <div class="form-group">
                <select id="c-category">
                  <option value="text">Некорректный текст</option>
                  <option value="boundary">Ошибка границ</option>
                  <option value="term">Проблема с термином</option>
                  <option value="crosstalk">Кросстолк</option>
                  <option value="general">Общее</option>
                </select>
              </div>
              <div class="form-group"><textarea id="c-text" placeholder="Комментарий к активному сегменту…"></textarea></div>
              <button class="btn btn-block" onclick="Verifier.addComment()">Добавить замечание</button>
              <div id="comments-box" style="margin-top:14px"></div>
            </div>
            <div class="card" style="padding:14px">
              <h3>Спорные термины проекта</h3>
              <div id="terms-box" style="max-height:260px; overflow-y:auto"></div>
            </div>
            <div class="card" style="padding:14px">
              <h3>Прошлые проверки</h3>
              <div id="results-box"></div>
            </div>
          </div>
        </div>
      </div>`;
  },

  async load() {
    const s = this.s;
    const [comments, source, edits, results, terms] = await Promise.all([
      API.comments(s.taskId).catch(() => []),
      API.sourceSegments(s.taskId).catch(() => []),
      API.segmentEdits(s.taskId).catch(() => []),
      API.verificationResults(s.taskId).catch(() => []),
      API.terms(s.task.project_id).catch(() => []),
    ]);
    s.comments = comments; s.source = source; s.edits = edits; s.results = results; s.terms = terms;
    this.renderTab();
    this.renderComments();
    this.renderResults();
    this.renderTerms();
    this.draw();
  },

  /* ---------- audio / waveform ---------- */
  get audio() { return document.getElementById('ws-audio'); },

  initAudio() {
    const s = this.s;
    const audio = this.audio;
    if (s.task.media_file_id) audio.src = API.mediaUrl(s.task.media_file_id);
    audio.addEventListener('timeupdate', () => {
      this.draw(); this.updateTime();
      const seg = this.active();
      if (this._playSeg && seg && audio.currentTime >= seg.end_time + 0.3) { this._playSeg = null; audio.pause(); }
    });
    audio.addEventListener('play', () => { const b = document.getElementById('v-play'); if (b) b.textContent = '⏸'; });
    audio.addEventListener('pause', () => { const b = document.getElementById('v-play'); if (b) b.textContent = '▶'; });
    const canvas = document.getElementById('waveform-canvas');
    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      const t = (e.clientX - rect.left) / s.pps;
      this.seek(t);
    });
  },

  updateTime() {
    const el = document.getElementById('time-display');
    if (el) el.textContent = `${App.fmtTime(this.audio.currentTime)} / ${App.fmtTime(this.s.task.duration)}`;
  },

  togglePlay() { const a = this.audio; a.paused ? a.play().catch(() => {}) : a.pause(); },
  seek(t) { const a = this.audio; a.currentTime = Math.max(0, Math.min(this.s.task.duration, t)); this.draw(); },
  playSegment() {
    const seg = this.active(); if (!seg) return;
    this._playSeg = true;
    this.audio.currentTime = Math.max(0, seg.start_time - 0.3);
    this.audio.play().catch(() => {});
  },
  active() { return this.s.segments.find(z => z.id === this.s.activeId) || null; },

  selectSegment(id) {
    this.s.activeId = id;
    this.draw(); this.renderList(); this.renderTab();
  },

  draw() {
    const s = this.s;
    const canvas = document.getElementById('waveform-canvas');
    if (!canvas) return;
    const scroll = document.getElementById('wf-scroll');
    const dur = s.task.duration || 1;
    s.pps = Math.max(4, (scroll.clientWidth - 4) / dur);
    const w = Math.max(1, Math.round(dur * s.pps)), h = 130;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#101728'; ctx.fillRect(0, 0, w, h);

    const colors = { pending: 'rgba(79,140,255,0.18)', checked: 'rgba(46,204,113,0.24)', disputed: 'rgba(231,76,60,0.26)', crosstalk: 'rgba(124,92,255,0.28)' };
    const borders = { pending: '#4f8cff', checked: '#2ecc71', disputed: '#e74c3c', crosstalk: '#7c5cff' };
    s.segments.forEach(seg => {
      const x0 = seg.start_time * s.pps, x1 = seg.end_time * s.pps;
      const bw = Math.max(1, x1 - x0), key = seg.is_crosstalk ? 'crosstalk' : seg.status;
      ctx.fillStyle = colors[key] || colors.pending;
      ctx.fillRect(x0, 8, bw, h - 16);
      ctx.strokeStyle = borders[key] || borders.pending;
      ctx.lineWidth = seg.id === s.activeId ? 2 : 1;
      ctx.strokeRect(x0 + 0.5, 8.5, bw - 1, h - 17);
      if (bw > 50) {
        ctx.fillStyle = '#e6ebf5'; ctx.font = '10px Segoe UI, sans-serif';
        ctx.save(); ctx.beginPath(); ctx.rect(x0 + 3, 8, bw - 6, h - 16); ctx.clip();
        ctx.fillText((seg.text || '').slice(0, 50), x0 + 4, 22); ctx.restore();
      }
    });
    const px = this.audio.currentTime * s.pps;
    ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  },

  renderList() {
    const s = this.s;
    const el = document.getElementById('seg-list');
    if (!el) return;
    el.innerHTML = [...s.segments].sort((a, b) => a.start_time - b.start_time).map(seg => `
      <div class="segment-item ${seg.id === s.activeId ? 'active' : ''}" onclick="Verifier.selectSegment(${seg.id})">
        <span class="time">${App.fmtTime(seg.start_time)}</span>
        <span class="text">${App.esc(seg.text || '(без текста)')}</span>
        <span class="flags">${seg.is_crosstalk ? '<span class="flag crosstalk">XT</span>' : ''}${seg.status === 'disputed' ? '<span class="flag disputed">⚑</span>' : ''}</span>
      </div>`).join('');
  },

  showTab(name) {
    this.s.tab = name;
    document.querySelectorAll('.ws-left .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    this.renderTab();
  },

  renderTab() {
    const s = this.s;
    const el = document.getElementById('tab-body');
    if (!el) return;
    if (s.tab === 'segments') {
      el.innerHTML = '<div class="segment-list" id="seg-list" style="max-height:420px"></div>';
      this.renderList();
    } else if (s.tab === 'compare') {
      const src = s.source;
      el.innerHTML = !src.length
        ? '<p style="color:var(--text-dim)">Исходная предразметка недоступна.</p>'
        : src.map((item, i) => {
          const cur = s.segments[i];
          const changed = cur && (cur.text || '') !== (item.text || '');
          const boundaryChanged = cur && (Math.abs(cur.start_time - (item.start || 0)) > 0.01 || Math.abs(cur.end_time - (item.end || 0)) > 0.01);
          return `
            <div class="compare-row ${changed || boundaryChanged ? 'changed' : ''}">
              <div class="compare-col">
                <div class="meta">Предразметка · ${App.fmtTime(item.start || 0)}–${App.fmtTime(item.end || 0)}</div>
                <div>${App.esc(item.text || '')}</div>
              </div>
              <div class="compare-col">
                <div class="meta">Текущая разметка${cur ? ` · ${App.fmtTime(cur.start_time)}–${App.fmtTime(cur.end_time)}` : ''}</div>
                <div>${App.esc(cur ? (cur.text || '') : '(сегмент отсутствует)')}</div>
              </div>
            </div>`;
        }).join('');
    } else if (s.tab === 'history') {
      el.innerHTML = s.edits.length ? s.edits.map(e => `
        <div class="comment">
          <div class="meta">сегмент #${e.segment_id} · поле <b>${App.esc(e.field)}</b> · ${App.fmtDate(e.created_at)}</div>
          <div><span style="color:var(--red)">${App.esc(String(e.old_value).slice(0, 120))}</span> → <span style="color:var(--green)">${App.esc(String(e.new_value).slice(0, 120))}</span></div>
        </div>`).join('') : '<p style="color:var(--text-dim)">История пуста.</p>';
    }
  },

  renderComments() {
    const el = document.getElementById('comments-box');
    if (!el) return;
    const s = this.s;
    el.innerHTML = s.comments.length ? s.comments.map(c => `
      <div class="comment">
        <div class="meta">${App.esc(c.author_name || '—')} · ${App.fmtDate(c.created_at)}
          ${c.segment_id ? `· сегмент #${c.segment_id}` : ''}
          <span class="cat">${App.esc(c.category)}</span></div>
        <div>${App.esc(c.text)}</div>
      </div>`).join('') : '<p style="color:var(--text-dim)">Замечаний нет.</p>';
  },

  renderTerms() {
    const el = document.getElementById('terms-box');
    if (!el) return;
    const disputed = this.s.terms.filter(t => t.type === 'disputed' || t.status === 'new' || t.status === 'on_review');
    el.innerHTML = disputed.length ? disputed.map(t => `
      <div class="comment">
        <div class="meta"><b>${App.esc(t.value)}</b> <span class="badge term-${t.status}">${App.termStatusLabel(t.status)}</span></div>
        ${t.comment ? `<div>${App.esc(t.comment)}</div>` : ''}
        <div style="margin-top:6px; display:flex; gap:6px">
          <button class="btn btn-sm btn-green" onclick="Verifier.termDecision(${t.id}, 'approve')">✓</button>
          <button class="btn btn-sm btn-red" onclick="Verifier.termDecision(${t.id}, 'reject')">✕</button>
        </div>
      </div>`).join('') : '<p style="color:var(--text-dim)">Нет терминов на проверку.</p>';
  },

  renderResults() {
    const el = document.getElementById('results-box');
    if (!el) return;
    el.innerHTML = this.s.results.length ? this.s.results.map(r => `
      <div class="comment">
        <div class="meta">${r.decision === 'accepted' ? 'Принято' : 'Возврат'} · ${App.fmtDate(r.created_at)}</div>
        <div>${App.esc(r.comment || '—')}</div>
      </div>`).join('') : '<p style="color:var(--text-dim)">Проверок ещё не было.</p>';
  },

  async termDecision(termId, action) {
    try {
      if (action === 'approve') await API.approveTerm(termId);
      else await API.rejectTerm(termId);
      const t = this.s.terms.find(z => z.id === termId);
      if (t) t.status = action === 'approve' ? 'approved' : 'rejected';
      this.renderTerms();
      toast('Статус термина обновлён', 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  async addComment() {
    const text = document.getElementById('c-text').value.trim();
    if (!text) { toast('Введите текст замечания', 'error'); return; }
    try {
      const c = await API.addComment(this.s.taskId, {
        task_id: this.s.taskId, text, segment_id: this.s.activeId,
        category: document.getElementById('c-category').value,
      });
      this.s.comments.unshift(c);
      document.getElementById('c-text').value = '';
      this.renderComments();
      toast('Замечание добавлено', 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  returnModal() {
    const modal = App.modal(`
      <h3>Возврат на доработку</h3>
      <p style="color:var(--text-dim); margin-bottom:12px">Укажите причину — разметчик получит замечание.</p>
      <div class="form-group"><label>Комментарий</label><textarea id="r-comment" placeholder="Что нужно исправить…"></textarea></div>
      <div class="form-group"><label>Оценка качества (0–100)</label><input type="number" id="r-score" min="0" max="100" value="70"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="App.closeModal()">Отмена</button>
        <button class="btn btn-yellow" onclick="Verifier.doReturn()">Вернуть на доработку</button>
      </div>`);
  },

  async doReturn() {
    try {
      await API.returnTask(this.s.taskId, {
        decision: 'returned',
        comment: document.getElementById('r-comment').value.trim(),
        score: parseFloat(document.getElementById('r-score').value) || 0,
      });
      App.closeModal();
      toast('Задача возвращена на доработку', 'success');
      App.navigate(`/tasks/${this.s.taskId}`);
    } catch (e) { toast(e.message, 'error'); }
  },

  acceptModal() {
    App.modal(`
      <h3>Приёмка задачи</h3>
      <p style="color:var(--text-dim); margin-bottom:12px">Задача будет принята после финальных автопроверок.</p>
      <div class="form-group"><label>Комментарий</label><textarea id="a-comment" placeholder="Комментарий (необязательно)"></textarea></div>
      <div class="form-group"><label>Оценка качества (0–100)</label><input type="number" id="a-score" min="0" max="100" value="100"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="App.closeModal()">Отмена</button>
        <button class="btn btn-green" onclick="Verifier.doAccept()">Принять</button>
      </div>`);
  },

  async doAccept() {
    try {
      await API.acceptTask(this.s.taskId, {
        decision: 'accepted',
        comment: document.getElementById('a-comment').value.trim(),
        score: parseFloat(document.getElementById('a-score').value) || 0,
      });
      App.closeModal();
      toast('Задача принята', 'success');
      App.navigate(`/tasks/${this.s.taskId}`);
    } catch (e) { toast(e.message, 'error'); }
  },
};
