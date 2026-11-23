/* ===== Рабочее место разметчика ===== */
const Annotator = {
  s: null,
  RATE: 50, // пиков в секунду (совпадает с backend sample_rate)

  async render(content, taskId) {
    content.innerHTML = '<div class="card">Загрузка рабочего места…</div>';
    const s = this.s = {
      taskId, task: null, media: null, segments: [], activeId: null,
      duration: 0, peaks: [], pps: 80, playhead: 0, listened: 0,
      loop: false, pad: 0.3, snap: true, rate: 1,
      pending: {}, saveTimer: null, saving: false,
      undo: [], redo: [], hints: [], checks: [], checklist: [], comments: [], terms: [],
      tab: 'hints', dirty: false,
    };

    try {
      const task = s.task = await API.task(taskId);
      s.duration = task.duration || 0;

      const jobs = [API.segments(taskId)];
      if (task.media_file_id) jobs.push(API.mediaInfo(task.media_file_id).catch(() => null));
      const [segments, media] = await Promise.all(jobs);
      s.segments = segments;
      s.media = media;
      if (media && media.duration) s.duration = media.duration;

      content.innerHTML = this.layout(task);
      this.initCanvas();
      this.initAudio();
      this.renderSegmentList();
      this.selectSegment(s.segments[0] ? s.segments[0].id : null);
      this.loadSidePanels();
      this.bindKeys();
      await this.loadWaveform();
      this.setSaveState('saved', 'Сохранено');
    } catch (e) {
      content.innerHTML = `<div class="card">Ошибка загрузки: ${App.esc(e.message)}</div>`;
    }
  },

  layout(task) {
    const s = this.s;
    const video = s.media && s.media.video_path;
    return `
      <div class="workspace">
        <div class="ws-topbar">
          <button class="btn btn-sm btn-ghost" onclick="App.navigate('/tasks/${task.id}')">← Назад</button>
          <span class="title">${App.esc(task.project_name)}</span>
          <span class="badge status-${task.status}">${App.statusLabel(task.status)}</span>
          <span style="color:var(--text-dim)">${App.esc(task.media_name || 'без медиа')}</span>
          <span id="save-indicator" class="save-indicator saved"><span class="dot"></span><span id="save-text">Сохранено</span></span>
          <div style="flex:1"></div>
          <button class="btn btn-sm btn-ghost" onclick="Annotator.saveNow()">💾 Сохранить</button>
          <button class="btn btn-sm btn-green" onclick="Annotator.openSubmit()">📤 Отправить на проверку</button>
        </div>

        <div class="ws-body">
          <div class="ws-left">
            ${video ? `<div class="card" style="padding:10px"><video id="video-panel" src="${API.mediaUrl(s.media.id)}" controls preload="metadata"></video></div>` : ''}
            <div class="waveform-wrap">
              <div class="waveform-scroll" id="wf-scroll"><canvas id="waveform-canvas"></canvas></div>
              <div class="waveform-toolbar">
                <button class="btn btn-sm" onclick="Annotator.togglePlay()" id="btn-play">▶</button>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.prevSegment()" title="Предыдущий сегмент">⏮</button>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.nextSegment()" title="Следующий сегмент">⏭</button>
                <button class="btn btn-sm btn-purple" onclick="Annotator.playSegment()">▶ Play Segment</button>
                <label class="chk-inline"><input type="checkbox" id="chk-loop" onchange="Annotator.s.loop=this.checked"> цикл</label>
                <label style="color:var(--text-dim)">скорость
                  <select id="sel-rate" style="width:auto;display:inline-block" onchange="Annotator.setRate(this.value)">
                    ${[0.5, 0.75, 1, 1.25, 1.5].map(r => `<option value="${r}" ${r === 1 ? 'selected' : ''}>${r}x</option>`).join('')}
                  </select>
                </label>
                <label style="color:var(--text-dim)">отступ
                  <select id="sel-pad" style="width:auto;display:inline-block" onchange="Annotator.s.pad=parseFloat(this.value)">
                    ${[0, 0.3, 0.5, 1].map(p => `<option value="${p}" ${p === 0.3 ? 'selected' : ''}>${p} с</option>`).join('')}
                  </select>
                </label>
                <label class="chk-inline"><input type="checkbox" checked onchange="Annotator.s.snap=this.checked"> snap-to-speech</label>
                <span style="flex:1"></span>
                <span class="time-display" id="time-display">0:00.00 / ${App.fmtTime(s.duration)}</span>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.zoom(-1)">－</button>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.zoom(1)">＋</button>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.zoom(0)">⤢</button>
              </div>
              <audio id="ws-audio" preload="auto" hidden></audio>
            </div>

            <div class="card">
              <div class="editor-toolbar">
                <button class="btn btn-sm" onclick="Annotator.newSegment()">＋ Сегмент</button>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.splitAtPlayhead()">✂ Разделить</button>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.mergeNext()">🔗 Объединить</button>
                <button class="btn btn-sm btn-red" onclick="Annotator.deleteSegment()">🗑 Удалить</button>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.importJson()">Импорт JSON</button>
                <input type="file" id="json-import" accept=".json,application/json" hidden onchange="Annotator.onJsonPicked(this)">
                <span style="flex:1"></span>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.undo()" title="Ctrl+Z">↶</button>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.redo()" title="Ctrl+Y">↷</button>
              </div>
              <div id="active-meta" style="color:var(--text-dim); font-size:12px; margin-bottom:8px"></div>
              <div class="grid" style="grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:10px">
                <div class="form-group" style="margin:0"><label>Начало, с</label><input type="number" step="0.01" id="inp-start" onchange="Annotator.applyBounds()"></div>
                <div class="form-group" style="margin:0"><label>Конец, с</label><input type="number" step="0.01" id="inp-end" onchange="Annotator.applyBounds()"></div>
                <div class="form-group" style="margin:0"><label>Спикер</label><input type="text" id="inp-speaker" onchange="Annotator.applySpeaker()"></div>
              </div>
              <textarea id="segment-textarea" placeholder="Текст сегмента…" oninput="Annotator.onTextInput()"></textarea>
              <div class="editor-toolbar" style="margin-top:8px">
                <button class="btn btn-sm btn-green" onclick="Annotator.setStatus('checked')">✓ Проверен</button>
                <button class="btn btn-sm btn-yellow" onclick="Annotator.setStatus('disputed')">⚑ Спорный</button>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.setStatus('pending')">↺ Сбросить</button>
                <label class="chk-inline"><input type="checkbox" id="chk-crosstalk" onchange="Annotator.toggleCrosstalk(this.checked)"> кросстолк</label>
                <span style="flex:1"></span>
                <button class="btn btn-sm btn-ghost" onclick="Annotator.termModal()">＋ В спорные термины</button>
              </div>
            </div>

            <div class="card">
              <h3>Сегменты (<span id="seg-count">${s.segments.length}</span>)</h3>
              <div class="segment-list" id="segment-list"></div>
            </div>
          </div>

          <div class="ws-right">
            <div class="card" style="padding:14px">
              <div class="tabs">
                <div class="tab active" data-tab="hints" onclick="Annotator.showTab('hints')">🤖 AI</div>
                <div class="tab" data-tab="checks" onclick="Annotator.showTab('checks')">🛡 Проверки</div>
                <div class="tab" data-tab="terms" onclick="Annotator.showTab('terms')">📚 Термины</div>
                <div class="tab" data-tab="comments" onclick="Annotator.showTab('comments')">💬 Замечания</div>
                <div class="tab" data-tab="checklist" onclick="Annotator.showTab('checklist')">☑ Чек-лист</div>
              </div>
              <div id="tab-body"></div>
            </div>
            <div class="card" style="padding:14px">
              <h3>Горячие клавиши</h3>
              <div class="hotkeys-grid">
                <div class="hk"><span>Проиграть / пауза</span><span class="hotkey">Space</span></div>
                <div class="hk"><span>Play Segment</span><span class="hotkey">Enter</span></div>
                <div class="hk"><span>Пред./след. сегмент</span><span class="hotkey">[ ]</span></div>
                <div class="hk"><span>Разделить</span><span class="hotkey">S</span></div>
                <div class="hk"><span>Сохранить</span><span class="hotkey">Ctrl+S</span></div>
                <div class="hk"><span>Undo / Redo</span><span class="hotkey">Ctrl+Z/Y</span></div>
                <div class="hk"><span>Проверен</span><span class="hotkey">C</span></div>
                <div class="hk"><span>Зум</span><span class="hotkey">＋ / －</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  },

  /* ---------- waveform ---------- */
  initCanvas() {
    const canvas = document.getElementById('waveform-canvas');
    if (!canvas) return;
    canvas.addEventListener('mousedown', e => this.onCanvasDown(e));
    this._onMove = e => this.onCanvasMove(e);
    this._onUp = e => this.onCanvasUp(e);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
    this._onResize = () => this.fitZoom();
    window.addEventListener('resize', this._onResize);
  },

  async loadWaveform() {
    const s = this.s;
    if (!s.task.media_file_id) { this.fitZoom(); this.draw(); return; }
    try {
      const wf = await API.waveform(s.task.media_file_id);
      s.peaks = wf.peaks || [];
      if (!s.duration) s.duration = wf.duration || (s.peaks.length / this.RATE) || 0;
    } catch (e) { /* без waveform тоже работаем */ }
    this.fitZoom();
    this.draw();
  },

  fitZoom() {
    const s = this.s;
    const scroll = document.getElementById('wf-scroll');
    if (!scroll || !s.duration) return;
    const avail = Math.max(300, scroll.clientWidth - 4);
    s.pps = Math.min(4000, Math.max(4, avail / s.duration));
    this.resizeCanvas();
    this.draw();
  },

  resizeCanvas() {
    const s = this.s;
    const canvas = document.getElementById('waveform-canvas');
    if (!canvas) return;
    const w = Math.max(1, Math.round(s.duration * s.pps));
    canvas.style.width = w + 'px';
    canvas.style.height = '170px';
  },

  zoom(dir) {
    const s = this.s;
    if (dir === 0) { this.fitZoom(); return; }
    s.pps = Math.max(4, Math.min(4000, s.pps * (dir > 0 ? 1.4 : 1 / 1.4)));
    this.resizeCanvas();
    this.draw();
  },

  draw() {
    const s = this.s;
    const canvas = document.getElementById('waveform-canvas');
    if (!canvas) return;
    const pps = s.pps;
    const w = Math.max(1, Math.round(s.duration * pps));
    const h = 170, rulerH = 22, top = rulerH + 8, bh = h - rulerH - 20, mid = top + bh / 2;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#101728'; ctx.fillRect(0, 0, w, h);

    // прослушанная часть
    if (s.listened > 0) {
      ctx.fillStyle = 'rgba(46,204,113,0.08)';
      ctx.fillRect(0, top, s.listened * pps, bh);
    }

    // линейка
    ctx.fillStyle = '#0c1220'; ctx.fillRect(0, 0, w, rulerH);
    const stepCandidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = stepCandidates.find(c => c * pps >= 60) || 600;
    ctx.font = '10px Consolas, monospace';
    for (let t = 0; t <= s.duration; t += step) {
      const x = Math.round(t * pps) + 0.5;
      ctx.strokeStyle = '#2a3550';
      ctx.beginPath(); ctx.moveTo(x, rulerH - 6); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillStyle = '#93a0b8';
      ctx.fillText(App.fmtTime(t), x + 3, 12);
    }

    // waveform
    const peaks = s.peaks;
    if (peaks.length) {
      const stepPx = Math.max(1, Math.floor(w / 4000));
      ctx.strokeStyle = '#3f6fd8';
      ctx.beginPath();
      for (let x = 0; x < w; x += stepPx) {
        const idx = Math.min(peaks.length - 1, Math.floor(x / w * peaks.length));
        const amp = peaks[idx] * (bh / 2);
        ctx.moveTo(x + 0.5, mid - amp);
        ctx.lineTo(x + 0.5, mid + amp);
      }
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#233154';
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    }

    // segments
    const colors = {
      pending: 'rgba(79,140,255,0.16)', checked: 'rgba(46,204,113,0.22)',
      disputed: 'rgba(231,76,60,0.24)', crosstalk: 'rgba(124,92,255,0.26)',
    };
    const borders = { pending: '#4f8cff', checked: '#2ecc71', disputed: '#e74c3c', crosstalk: '#7c5cff' };
    const byId = {};
    s.segments.forEach(seg => {
      const x0 = seg.start_time * pps, x1 = seg.end_time * pps;
      const bw = Math.max(1, x1 - x0);
      const key = seg.is_crosstalk ? 'crosstalk' : seg.status;
      ctx.fillStyle = colors[key] || colors.pending;
      ctx.fillRect(x0, top, bw, bh);
      ctx.strokeStyle = borders[key] || borders.pending;
      ctx.lineWidth = seg.id === s.activeId ? 2 : 1;
      ctx.strokeRect(x0 + 0.5, top + 0.5, bw - 1, bh - 1);
      byId[seg.id] = { x0, x1 };
      if (bw > 60) {
        ctx.fillStyle = '#e6ebf5';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.save();
        ctx.beginPath(); ctx.rect(x0 + 3, top, bw - 6, bh); ctx.clip();
        ctx.fillText((seg.text || '(без текста)').slice(0, 60), x0 + 4, top + 14);
        ctx.restore();
      }
    });

    // handles активного сегмента
    const act = this.active();
    if (act) {
      const m = byId[act.id];
      if (m) {
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath(); ctx.moveTo(m.x0, top); ctx.lineTo(m.x0 + 7, top); ctx.lineTo(m.x0, top + 7); ctx.fill();
        ctx.beginPath(); ctx.moveTo(m.x1, top); ctx.lineTo(m.x1 - 7, top); ctx.lineTo(m.x1, top + 7); ctx.fill();
      }
    }

    // playhead
    const px = s.playhead * pps;
    ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, rulerH); ctx.lineTo(px, h); ctx.stroke();
    this._byId = byId;
  },

  onCanvasDown(e) {
    const s = this.s;
    const canvas = document.getElementById('waveform-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = Math.max(0, Math.min(s.duration, x / s.pps));
    const act = this.active();
    if (act) {
      if (Math.abs(x - act.start_time * s.pps) < 7) { this._drag = { id: act.id, type: 'start' }; return; }
      if (Math.abs(x - act.end_time * s.pps) < 7) { this._drag = { id: act.id, type: 'end' }; return; }
    }
    const hit = s.segments.find(sg => t >= sg.start_time && t <= sg.end_time);
    if (hit) this.selectSegment(hit.id, true); else this.seek(t);
  },

  onCanvasMove(e) {
    if (!this._drag) return;
    const s = this.s;
    const canvas = document.getElementById('waveform-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const t = Math.max(0, Math.min(s.duration, (e.clientX - rect.left) / s.pps));
    const seg = s.segments.find(z => z.id === this._drag.id);
    if (!seg) return;
    const snapped = this.snapTime(t);
    if (this._drag.type === 'start') seg.start_time = Math.min(snapped, seg.end_time - 0.05);
    else seg.end_time = Math.max(snapped, seg.start_time + 0.05);
    this.draw();
    this.updateActiveMeta();
  },

  onCanvasUp() {
    if (!this._drag) return;
    const s = this.s;
    const seg = s.segments.find(z => z.id === this._drag.id);
    this._drag = null;
    if (!seg) return;
    seg.start_time = Math.round(seg.start_time * 100) / 100;
    seg.end_time = Math.round(seg.end_time * 100) / 100;
    this.saveSegment(seg.id, { start_time: seg.start_time, end_time: seg.end_time });
    this.renderSegmentList();
    this.refreshChecks();
  },

  snapTime(t) {
    const s = this.s;
    if (!s.snap || !s.peaks.length) return Math.round(t * 100) / 100;
    const idx = Math.max(1, Math.min(s.peaks.length - 1, Math.round(t * this.RATE)));
    const thr = 0.12;
    for (let d = 0; d <= Math.round(this.RATE * 0.3); d++) {
      const i = idx - d;
      if (i > 0 && s.peaks[i] >= thr && s.peaks[i - 1] < thr) return Math.round((i / this.RATE) * 100) / 100;
    }
    return Math.round(t * 100) / 100;
  },

  /* ---------- audio ---------- */
  initAudio() {
    const audio = this.audio;
    if (!audio) return;
    if (this.s.task.media_file_id) audio.src = API.mediaUrl(this.s.task.media_file_id);
    audio.playbackRate = this.s.rate;
    audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    audio.addEventListener('loadedmetadata', () => {
      const s = this.s;
      if ((!s.duration || s.duration < 0.1) && audio.duration && isFinite(audio.duration)) {
        s.duration = audio.duration; this.fitZoom();
      }
      this.updateTimeDisplay();
    });
    audio.addEventListener('play', () => { const b = document.getElementById('btn-play'); if (b) b.textContent = '⏸'; });
    audio.addEventListener('pause', () => { const b = document.getElementById('btn-play'); if (b) b.textContent = '▶'; });
  },

  get audio() { return document.getElementById('ws-audio'); },

  onTimeUpdate() {
    const s = this.s, audio = this.audio;
    if (!audio) return;
    s.playhead = audio.currentTime;
    s.listened = Math.max(s.listened, audio.currentTime);
    const seg = this.active();
    if (s.loop && seg && audio.currentTime >= seg.end_time + s.pad) {
      audio.currentTime = Math.max(0, seg.start_time - s.pad);
    }
    if (this._playSeg && seg && audio.currentTime >= seg.end_time + this._playSeg.pad) {
      this._playSeg = null;
      audio.pause();
    }
    this.draw();
    this.updateTimeDisplay();
    this.keepPlayheadVisible();
  },

  updateTimeDisplay() {
    const el = document.getElementById('time-display');
    const s = this.s;
    if (el) el.textContent = `${App.fmtTime(s.playhead)} / ${App.fmtTime(s.duration)}`;
  },

  keepPlayheadVisible() {
    const s = this.s, scroll = document.getElementById('wf-scroll');
    if (!scroll) return;
    const x = s.playhead * s.pps;
    if (x < scroll.scrollLeft + 40) scroll.scrollLeft = Math.max(0, x - 120);
    else if (x > scroll.scrollLeft + scroll.clientWidth - 40) scroll.scrollLeft = x - scroll.clientWidth + 160;
  },

  seek(t) {
    const s = this.s, audio = this.audio;
    s.playhead = Math.max(0, Math.min(s.duration, t));
    if (audio) audio.currentTime = s.playhead;
    this.draw(); this.updateTimeDisplay();
  },

  togglePlay() {
    const audio = this.audio;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => toast('Не удалось воспроизвести файл', 'error'));
    else audio.pause();
  },

  playSegment() {
    const s = this.s, audio = this.audio, seg = this.active();
    if (!audio || !seg) return;
    this._playSeg = { pad: s.pad };
    this._playSegPadApplied = s.pad;
    audio.currentTime = Math.max(0, seg.start_time - s.pad);
    audio.play().catch(() => {});
  },

  setRate(v) { this.s.rate = parseFloat(v); if (this.audio) this.audio.playbackRate = this.s.rate; },

  /* ---------- segments ---------- */
  active() { return this.s.segments.find(z => z.id === this.s.activeId) || null; },

  selectSegment(id, silent) {
    const s = this.s;
    s.activeId = id;
    const seg = this.active();
    const ta = document.getElementById('segment-textarea');
    if (seg) {
      if (ta) ta.value = seg.text || '';
      document.getElementById('inp-start').value = seg.start_time.toFixed(2);
      document.getElementById('inp-end').value = seg.end_time.toFixed(2);
      document.getElementById('inp-speaker').value = seg.speaker_name || '';
      const cb = document.getElementById('chk-crosstalk');
      if (cb) cb.checked = !!seg.is_crosstalk;
      this._lastText = seg.text || '';
      this._lastSegId = seg.id;
    } else {
      if (ta) ta.value = '';
      this._lastText = ''; this._lastSegId = null;
    }
    this.updateActiveMeta();
    this.draw();
    this.renderSegmentList();
    if (id && !silent) this.scrollToSegment(id);
  },

  scrollToSegment(id) {
    const el = document.querySelector(`.segment-item[data-id="${id}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  },

  updateActiveMeta() {
    const seg = this.active();
    const el = document.getElementById('active-meta');
    if (!el) return;
    if (!seg) { el.textContent = 'Сегмент не выбран'; return; }
    const segStatus = { pending: 'Ожидает', checked: 'Проверен', disputed: 'Спорный', crosstalk: 'Кросстолк' }[seg.status] || seg.status;
    el.innerHTML = `Сегмент <b>#${seg.id}</b> · ${App.fmtTime(seg.start_time)} – ${App.fmtTime(seg.end_time)}
      (${(seg.end_time - seg.start_time).toFixed(2)} с) · уверенность ASR ${(seg.confidence ?? 1).toFixed(2)}
      · статус: ${App.esc(segStatus)}`;
  },

  renderSegmentList() {
    const s = this.s;
    const el = document.getElementById('segment-list');
    if (!el) return;
    const sorted = [...s.segments].sort((a, b) => a.start_time - b.start_time);
    const cnt = document.getElementById('seg-count');
    if (cnt) cnt.textContent = sorted.length;
    el.innerHTML = sorted.map(seg => `
      <div class="segment-item ${seg.id === s.activeId ? 'active' : ''}" data-id="${seg.id}" onclick="Annotator.selectSegment(${seg.id})">
        <span class="time">${App.fmtTime(seg.start_time)}<br>${App.fmtTime(seg.end_time)}</span>
        <span class="text ${(seg.text || '').trim() ? '' : 'empty'}">${App.esc(seg.text || '(без текста)')}</span>
        <span class="flags">
          ${seg.is_crosstalk ? '<span class="flag crosstalk">XT</span>' : ''}
          ${(seg.confidence ?? 1) < 0.6 ? '<span class="flag lowconf">low</span>' : ''}
          ${seg.status === 'checked' ? '<span class="flag" style="background:#1e8449;color:#fff">✓</span>' : ''}
          ${seg.status === 'disputed' ? '<span class="flag disputed">⚑</span>' : ''}
        </span>
      </div>`).join('') || '<p style="color:var(--text-dim)">Сегментов нет. Создайте первый.</p>';
  },

  onTextInput() {
    const ta = document.getElementById('segment-textarea');
    const seg = this.active();
    if (!seg || !ta) return;
    if (this._lastSegId !== seg.id) { this._lastText = seg.text || ''; this._lastSegId = seg.id; }
    const now = ta.value;
    if (now !== this._lastText) {
      this.s.undo.push({ segId: seg.id, from: this._lastText, to: now });
      if (this.s.undo.length > 300) this.s.undo.shift();
      this.s.redo = [];
      this._lastText = now;
    }
    this.queueSave({ text: now });
  },

  applyBounds() {
    const seg = this.active();
    if (!seg) return;
    const st = Math.max(0, parseFloat(document.getElementById('inp-start').value));
    const en = Math.min(this.s.duration, parseFloat(document.getElementById('inp-end').value));
    if (isNaN(st) || isNaN(en) || en <= st) { toast('Некорректные границы', 'error'); return; }
    seg.start_time = Math.round(st * 100) / 100;
    seg.end_time = Math.round(en * 100) / 100;
    this.draw(); this.renderSegmentList(); this.refreshChecks();
    this.saveSegment(seg.id, { start_time: seg.start_time, end_time: seg.end_time });
  },

  applySpeaker() {
    const seg = this.active();
    if (!seg) return;
    seg.speaker_name = document.getElementById('inp-speaker').value;
    this.queueSave({ speaker_name: seg.speaker_name });
  },

  setStatus(status) {
    const seg = this.active();
    if (!seg) return;
    seg.status = status;
    this.saveSegment(seg.id, { status });
    this.renderSegmentList(); this.draw();
  },

  toggleCrosstalk(v) {
    const seg = this.active();
    if (!seg) return;
    seg.is_crosstalk = v;
    this.saveSegment(seg.id, { is_crosstalk: v, status: v ? 'crosstalk' : (seg.status === 'crosstalk' ? 'pending' : seg.status) });
    this.renderSegmentList(); this.draw(); this.refreshChecks();
  },

  prevSegment() { this.gotoRel(-1); },
  nextSegment() { this.gotoRel(1); },
  gotoRel(dir) {
    const sorted = [...this.s.segments].sort((a, b) => a.start_time - b.start_time);
    if (!sorted.length) return;
    let i = sorted.findIndex(z => z.id === this.s.activeId);
    if (i === -1) i = dir > 0 ? -1 : sorted.length;
    const next = sorted[Math.max(0, Math.min(sorted.length - 1, i + dir))];
    this.selectSegment(next.id);
    this.seek(next.start_time);
  },

  async newSegment() {
    const s = this.s;
    const start = Math.round(s.playhead * 100) / 100;
    try {
      const seg = await API.createSegment({ task_id: s.taskId, start_time: start, end_time: Math.round((start + 2) * 100) / 100, text: '', speaker_name: '' });
      s.segments.push(seg);
      this.renderSegmentList(); this.draw();
      this.selectSegment(seg.id);
      toast('Сегмент создан', 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  importJson() {
    const input = document.getElementById('json-import');
    if (input) input.click();
  },

  async onJsonPicked(input) {
    if (!input.files || !input.files.length) return;
    const s = this.s;
    const fd = new FormData();
    fd.append('file', input.files[0]);
    try {
      const res = await API.importPreannotation(s.taskId, fd);
      s.segments = await API.segments(s.taskId);
      this.renderSegmentList();
      this.draw();
      this.selectSegment(s.segments[0] ? s.segments[0].id : null);
      this._refreshChecksSoon();
      toast(`Импортировано сегментов: ${res.imported}`, 'success');
    } catch (e) {
      toast('Не удалось импортировать JSON: ' + e.message, 'error');
    }
    input.value = '';
  },

  async splitAtPlayhead() {
    const seg = this.active();
    const s = this.s;
    const at = Math.round(s.playhead * 100) / 100;
    if (!seg || at <= seg.start_time || at >= seg.end_time) { toast('Курсор вне выбранного сегмента', 'error'); return; }
    try {
      s.segments = await API.splitSegment(seg.id, at);
      this.renderSegmentList(); this.draw(); this.refreshChecks();
      toast('Сегмент разделён', 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  async mergeNext() {
    const s = this.s;
    const sorted = [...s.segments].sort((a, b) => a.start_time - b.start_time);
    const i = sorted.findIndex(z => z.id === s.activeId);
    if (i === -1 || i === sorted.length - 1) { toast('Нужен следующий сегмент для объединения', 'error'); return; }
    try {
      s.segments = await API.mergeSegments([sorted[i].id, sorted[i + 1].id]);
      this.selectSegment(sorted[i].id);
      this.draw(); this.refreshChecks();
      toast('Сегменты объединены', 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  async deleteSegment() {
    const seg = this.active();
    if (!seg) return;
    if (!confirm(`Удалить сегмент #${seg.id}?`)) return;
    try {
      await API.deleteSegment(seg.id);
      this.s.segments = this.s.segments.filter(z => z.id !== seg.id);
      this.selectSegment(this.s.segments[0] ? this.s.segments[0].id : null);
      this.draw(); this.refreshChecks();
      toast('Сегмент удалён', 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ---------- saving ---------- */
  queueSave(patch) {
    const seg = this.active();
    if (!seg) return;
    this.s.pending = { ...this.s.pending, ...patch };
    seg.text = this.s.pending.text !== undefined ? this.s.pending.text : seg.text;
    this.setSaveState('saving', 'Сохранение…');
    clearTimeout(this.s.saveTimer);
    this.s.saveTimer = setTimeout(() => this.flush(), 1200); // ≤ 5 c по ТЗ
  },

  async flush() {
    const s = this.s;
    if (!s.pending || Object.keys(s.pending).length === 0) return;
    const seg = this.active();
    if (!seg || !document.getElementById('waveform-canvas')) { s.pending = {}; return; }
    const patch = s.pending; s.pending = {};
    await this.saveSegment(seg.id, patch);
  },

  async saveSegment(id, patch) {
    const s = this.s;
    try {
      this.setSaveState('saving', 'Сохранение…');
      const updated = await API.updateSegment(id, patch);
      const idx = s.segments.findIndex(z => z.id === id);
      if (idx !== -1) s.segments[idx] = { ...s.segments[idx], ...updated };
      this.setSaveState('saved', 'Сохранено');
      this._refreshChecksSoon();
    } catch (e) {
      this.setSaveState('error', 'Ошибка сохранения');
      toast('Не удалось сохранить: ' + e.message, 'error');
    }
  },

  async saveNow() {
    clearTimeout(this.s.saveTimer);
    await this.flush();
    toast('Сохранено', 'success');
  },

  setSaveState(state, text) {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    el.className = `save-indicator ${state}`;
    const t = document.getElementById('save-text');
    if (t) t.textContent = text;
  },

  _refreshChecksSoon() {
    clearTimeout(this._checksTimer);
    this._checksTimer = setTimeout(() => this.refreshChecks(), 800);
  },

  /* ---------- undo/redo (текст) ---------- */
  undo() {
    const s = this.s;
    if (!s.undo.length) return;
    const action = s.undo.pop();
    const seg = s.segments.find(z => z.id === action.segId);
    if (seg) { seg.text = action.from; if (seg.id === s.activeId) document.getElementById('segment-textarea').value = action.from; }
    s.redo.push(action);
    this.saveSegment(action.segId, { text: action.from });
  },

  redo() {
    const s = this.s;
    if (!s.redo.length) return;
    const action = s.redo.pop();
    const seg = s.segments.find(z => z.id === action.segId);
    if (seg) { seg.text = action.to; if (seg.id === s.activeId) document.getElementById('segment-textarea').value = action.to; }
    s.undo.push(action);
    this.saveSegment(action.segId, { text: action.to });
  },

  /* ---------- правая панель ---------- */
  showTab(name) {
    this.s.tab = name;
    document.querySelectorAll('.ws-right .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    this.renderTab();
  },

  renderTab() {
    const s = this.s;
    const el = document.getElementById('tab-body');
    if (!el) return;
    if (s.tab === 'hints') {
      el.innerHTML = s.hints.length ? s.hints.map(h => `
        <div class="hint ${h.severity}">
          <div class="hint-type">${App.esc(h.type)} ${h.segment_id ? '· сегмент #' + h.segment_id : ''}</div>
          <div>${App.esc(h.message)}</div>
          ${h.suggestion ? `<button class="btn btn-sm btn-ghost" style="margin-top:6px" onclick="Annotator.applySuggestion(${h.segment_id}, '${App.esc(h.suggestion).replace(/'/g, "\\'")}')">Применить: ${App.esc(h.suggestion)}</button>` : ''}
        </div>`).join('') : '<p style="color:var(--text-dim)">Подсказок нет. Отлично!</p>';
    } else if (s.tab === 'checks') {
      const errs = s.checks.filter(c => c.result === 'error');
      el.innerHTML = `
        <div style="margin-bottom:10px; font-size:13px">
          Ошибок: <b style="color:var(--red)">${errs.length}</b> ·
          предупреждений: <b style="color:var(--yellow)">${s.checks.filter(c => c.result === 'warning').length}</b>
        </div>
        ${s.checks.length ? s.checks.map(c => `
          <div class="qc ${c.result}" onclick="${c.segment_id ? `Annotator.selectSegment(${c.segment_id})` : ''}">
            <span>${App.esc(c.message)}</span>
          </div>`).join('') : '<p style="color:var(--text-dim)">Автоматических замечаний нет.</p>'}`;
    } else if (s.tab === 'terms') {
      el.innerHTML = `
        <div style="display:flex; gap:6px; margin-bottom:10px">
          <input type="text" id="term-search" placeholder="Поиск термина…" oninput="Annotator.filterTerms()">
          <button class="btn btn-sm" onclick="Annotator.termModal()">＋</button>
        </div>
        <div id="terms-list">${this.termsHtml(s.terms)}</div>`;
    } else if (s.tab === 'comments') {
      el.innerHTML = `
        <div style="display:flex; gap:6px; margin-bottom:10px">
          <input type="text" id="ws-comment" placeholder="Замечание…">
          <button class="btn btn-sm" onclick="Annotator.addComment()">＋</button>
        </div>
        ${s.comments.length ? s.comments.map(c => `
          <div class="comment">
            <div class="meta">${App.esc(c.author_name || '—')} · ${App.fmtDate(c.created_at)}
              ${c.segment_id ? `· сегмент #${c.segment_id}` : ''}</div>
            <span>${App.esc(c.text)}</span>
            ${c.status === 'open' ? `<a style="float:right;color:var(--green);cursor:pointer" onclick="Annotator.resolveComment(${c.id})">Закрыть</a>` : '<span class="flag" style="float:right">закрыто</span>'}
          </div>`).join('') : '<p style="color:var(--text-dim)">Замечаний нет.</p>'}`;
    } else if (s.tab === 'checklist') {
      el.innerHTML = s.checklist.map(i => `
        <label class="checklist-item">
          <input type="checkbox" ${i.checked ? 'checked' : ''} onchange="Annotator.toggleChecklist('${i.key}', this.checked)">
          <span>${App.esc(i.label)}</span>
        </label>`).join('');
    }
  },

  termsHtml(terms) {
    if (!terms.length) return '<p style="color:var(--text-dim)">Терминов нет.</p>';
    return terms.map(t => `
      <div class="comment">
        <div class="meta">
          <b>${App.esc(t.value)}</b>
          <span class="badge term-${t.status}">${App.termStatusLabel(t.status)}</span>
          <span class="cat">${App.esc(t.type)}</span>
        </div>
        ${t.comment ? `<div>${App.esc(t.comment)}</div>` : ''}
        ${t.suggested_variant ? `<div style="color:var(--cyan)">вариант: ${App.esc(t.suggested_variant)}</div>` : ''}
      </div>`).join('');
  },

  filterTerms() {
    const q = (document.getElementById('term-search').value || '').toLowerCase();
    const filtered = this.s.terms.filter(t => t.value.toLowerCase().includes(q));
    document.getElementById('terms-list').innerHTML = this.termsHtml(filtered);
  },

  applySuggestion(segmentId, text) {
    const seg = this.s.segments.find(z => z.id === segmentId);
    if (!seg) return;
    seg.text = text;
    if (seg.id === this.s.activeId) document.getElementById('segment-textarea').value = text;
    this.saveSegment(seg.id, { text });
    this.renderSegmentList();
    toast('Подсказка применена', 'success');
  },

  async addComment() {
    const input = document.getElementById('ws-comment');
    const text = input.value.trim();
    if (!text) return;
    try {
      const c = await API.addComment(this.s.taskId, { task_id: this.s.taskId, text, segment_id: this.s.activeId });
      this.s.comments.unshift(c);
      this.renderTab();
      toast('Замечание добавлено', 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  async resolveComment(id) {
    try {
      await API.resolveComment(id);
      const c = this.s.comments.find(z => z.id === id);
      if (c) c.status = 'resolved';
      this.renderTab();
    } catch (e) { toast(e.message, 'error'); }
  },

  async toggleChecklist(key, checked) {
    const item = this.s.checklist.find(i => i.key === key);
    if (item) item.checked = checked;
    try {
      await API.saveChecklist(this.s.taskId, this.s.checklist.map(i => ({ key: i.key, label: i.label, checked: i.checked })));
    } catch (e) { toast(e.message, 'error'); }
  },

  async termModal() {
    const s = this.s;
    const seg = this.active();
    const selected = this.selectedText() || (seg ? (seg.text || '').split(/\s+/).find(w => /[A-Za-z]/.test(w)) || '' : '');
    const modal = App.modal(`
      <h3>Добавить термин</h3>
      <form id="term-form">
        <div class="form-group"><label>Термин</label><input type="text" id="tm-value" value="${App.esc(selected)}" required></div>
        <div class="form-group"><label>Тип</label>
          <select id="tm-type">
            <option value="term">Термин</option>
            <option value="abbreviation">Аббревиатура</option>
            <option value="disputed">Спорный</option>
            <option value="unknown">Неопознанный</option>
          </select>
        </div>
        <div class="form-group"><label>Вариант написания</label><input type="text" id="tm-variant"></div>
        <div class="form-group"><label>Комментарий</label><textarea id="tm-comment"></textarea></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Отмена</button>
          <button type="submit" class="btn btn-green">Добавить</button>
        </div>
      </form>`);
    modal.querySelector('#term-form').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const term = await API.createTerm({
          project_id: s.task.project_id,
          value: document.getElementById('tm-value').value.trim(),
          type: document.getElementById('tm-type').value,
          suggested_variant: document.getElementById('tm-variant').value.trim(),
          comment: document.getElementById('tm-comment').value.trim(),
        });
        s.terms.unshift(term);
        App.closeModal();
        this.showTab('terms');
        toast('Термин добавлен', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
  },

  selectedText() {
    const ta = document.getElementById('segment-textarea');
    if (!ta) return '';
    return (ta.value.substring(ta.selectionStart, ta.selectionEnd) || '').trim();
  },

  /* ---------- загрузка данных панелей ---------- */
  async loadSidePanels() {
    const s = this.s;
    const jobs = [
      API.hints(s.taskId).catch(() => []),
      API.qualityChecks(s.taskId).catch(() => []),
      API.checklist(s.taskId).catch(() => []),
      API.comments(s.taskId).catch(() => []),
      API.terms(s.task.project_id).catch(() => []),
    ];
    const [hints, checks, checklist, comments, terms] = await Promise.all(jobs);
    s.hints = hints; s.checks = checks; s.checklist = checklist; s.comments = comments; s.terms = terms;
    // чек-лист по умолчанию, если пуст
    if (!s.checklist.length) {
      s.checklist = [
        ['listened_full', 'Запись прослушана до конца'], ['segments_checked', 'Все сегменты проверены'],
        ['boundaries_fixed', 'Границы сегментов исправлены'], ['truncated_checked', 'Обрезанные слова проверены'],
        ['missed_speech_added', 'Пропущенная речь добавлена'], ['bad_removed', 'Некорректная разметка удалена'],
        ['crosstalks_handled', 'Кросстолки обработаны'], ['short_replies_added', 'Значимые короткие реплики добавлены'],
        ['terms_checked', 'Термины проверены'], ['disputed_terms_fixed', 'Спорные термины зафиксированы'],
        ['no_unsaved', 'Несохранённых изменений нет'],
      ].map(([key, label]) => ({ key, label, checked: false }));
    }
    this.renderTab();
    this._checksTimer = null;
  },

  async refreshChecks() {
    const s = this.s;
    try {
      s.checks = await API.qualityChecks(s.taskId);
      if (s.tab === 'checks') this.renderTab();
    } catch (e) { /* ignore */ }
  },

  /* ---------- отправка ---------- */
  async openSubmit() {
    clearTimeout(this.s.saveTimer);
    await this.flush();
    await this.refreshChecks();
    const s = this.s;
    const errs = s.checks.filter(c => c.result === 'error');
    const unchecked = s.checklist.filter(i => !i.checked);
    const modal = App.modal(`
      <h3>Отправка на проверку</h3>
      <p style="color:var(--text-dim); margin-bottom:12px">Автоматические проверки и чек-лист должны быть пройдены.</p>
      <div style="margin-bottom:12px">
        <b>Автопроверки:</b> ошибок <span style="color:var(--red)">${errs.length}</span>,
        предупреждений <span style="color:var(--yellow)">${s.checks.filter(c => c.result === 'warning').length}</span>
        ${errs.length ? `<div style="margin-top:8px">${errs.map(c => `<div class="qc error">${App.esc(c.message)}</div>`).join('')}</div>` : ''}
      </div>
      <div style="margin-bottom:12px">
        <b>Чек-лист:</b> ${unchecked.length ? `<span style="color:var(--yellow)">не отмечено ${unchecked.length} пунктов</span>` : '<span style="color:var(--green)">всё отмечено</span>'}
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="App.closeModal(); Annotator.showTab('checklist')">Открыть чек-лист</button>
        <button class="btn btn-green" onclick="Annotator.submitTask()">Отправить</button>
      </div>`);
  },

  async submitTask() {
    try {
      await API.submitTask(this.s.taskId);
      App.closeModal();
      toast('Задача отправлена на проверку', 'success');
      App.navigate(`/tasks/${this.s.taskId}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  /* ---------- горячие клавиши ---------- */
  bindKeys() {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    this._keyHandler = e => {
      if (!document.getElementById('waveform-canvas')) {
        document.removeEventListener('keydown', this._keyHandler);
        return;
      }
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = tag === 'TEXTAREA' || tag === 'INPUT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveNow(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
      if (typing) return;
      if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.playSegment(); }
      else if (e.key === '[') { this.prevSegment(); }
      else if (e.key === ']') { this.nextSegment(); }
      else if (e.key.toLowerCase() === 's') { this.splitAtPlayhead(); }
      else if (e.key.toLowerCase() === 'c') { this.setStatus('checked'); }
      else if (e.key === '+' || e.key === '=') { this.zoom(1); }
      else if (e.key === '-') { this.zoom(-1); }
      else if (e.key === 'ArrowLeft') { this.seek(this.s.playhead - (e.shiftKey ? 1 : 0.05)); }
      else if (e.key === 'ArrowRight') { this.seek(this.s.playhead + (e.shiftKey ? 1 : 0.05)); }
    };
    document.addEventListener('keydown', this._keyHandler);
  },
};
