/* ===== API-клиент ===== */
const API = {
  base: '/api',

  token() { return localStorage.getItem('gecko_token'); },
  setToken(t) { localStorage.setItem('gecko_token', t); },
  clearToken() { localStorage.removeItem('gecko_token'); },

  async request(method, path, body, isForm) {
    const headers = {};
    const token = this.token();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let payload;
    if (body !== undefined) {
      if (isForm) {
        payload = body;
      } else {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    }
    const res = await fetch(this.base + path, { method, headers, body: payload });
    if (res.status === 401) {
      App.logout(true);
      throw new Error('Сессия истекла');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail || 'Ошибка запроса';
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
      throw new Error(msg);
    }
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },
  upload(path, formData) { return this.request('POST', path, formData, true); },

  // Auth
  login(email, password) { return this.post('/auth/login', { email, password }); },
  register(data) { return this.post('/auth/register', data); },
  me() { return this.get('/auth/me'); },

  // Projects
  projects() { return this.get('/projects'); },
  createProject(data) { return this.post('/projects', data); },
  project(id) { return this.get(`/projects/${id}`); },
  updateProject(id, data) { return this.put(`/projects/${id}`, data); },
  deleteProject(id) { return this.del(`/projects/${id}`); },

  // Tasks
  tasks(params = '') { return this.get(`/tasks${params}`); },
  createTask(data) { return this.post('/tasks', data); },
  task(id) { return this.get(`/tasks/${id}`); },
  startTask(id) { return this.post(`/tasks/${id}/start`); },
  submitTask(id) { return this.post(`/tasks/${id}/submit`); },
  assignTask(id, data) { return this.post(`/tasks/${id}/assign`, data); },
  changeTaskStatus(id, status) { return this.put(`/tasks/${id}/status`, { status }); },
  checklist(id) { return this.get(`/tasks/${id}/checklist`); },
  saveChecklist(id, items) { return this.put(`/tasks/${id}/checklist`, items); },
  qualityChecks(id) { return this.get(`/tasks/${id}/quality-checks`); },

  // Media
  uploadMedia(formData) { return this.upload('/media/upload', formData); },
  mediaList(params = '') { return this.get(`/media${params}`); },
  mediaInfo(id) { return this.get(`/media/${id}/info`); },
  waveform(id) { return this.get(`/media/${id}/waveform`); },
  mediaUrl(id) {
    const t = this.token();
    return `${this.base}/media/${id}${t ? `?token=${encodeURIComponent(t)}` : ''}`;
  },

  // Segments
  segments(taskId) { return this.get(`/segments/task/${taskId}`); },
  createSegment(data) { return this.post('/segments', data); },
  updateSegment(id, data) { return this.put(`/segments/${id}`, data); },
  deleteSegment(id) { return this.del(`/segments/${id}`); },
  splitSegment(id, atTime) { return this.post(`/segments/${id}/split`, { at_time: atTime }); },
  mergeSegments(ids) { return this.post('/segments/merge', { segment_ids: ids }); },
  importPreannotation(taskId, formData) { return this.upload(`/segments/task/${taskId}/import`, formData); },

  // Transcripts
  transcript(taskId) { return this.get(`/tasks/${taskId}/transcript`); },
  versions(taskId) { return this.get(`/tasks/${taskId}/versions`); },
  restoreVersion(taskId, versionId) { return this.post(`/tasks/${taskId}/restore`, { version_id: versionId }); },
  segmentEdits(taskId) { return this.get(`/tasks/${taskId}/segment-edits`); },
  sourceSegments(taskId) { return this.get(`/tasks/${taskId}/source-segments`); },

  // Terms
  terms(projectId, params = '') { return this.get(`/terms/project/${projectId}${params}`); },
  createTerm(data) { return this.post('/terms', data); },
  updateTerm(id, data) { return this.put(`/terms/${id}`, data); },
  approveTerm(id) { return this.post(`/terms/${id}/approve`); },
  rejectTerm(id) { return this.post(`/terms/${id}/reject`); },
  importTerms(projectId, formData) { return this.upload(`/terms/project/${projectId}/import`, formData); },
  exportTerms(projectId) { return this.get(`/terms/project/${projectId}/export`); },

  // Verification
  comments(taskId) { return this.get(`/tasks/${taskId}/comments`); },
  addComment(taskId, data) { return this.post(`/tasks/${taskId}/comments`, data); },
  resolveComment(id) { return this.put(`/tasks/comments/${id}/resolve`); },
  returnTask(taskId, data) { return this.post(`/tasks/${taskId}/return`, data); },
  acceptTask(taskId, data) { return this.post(`/tasks/${taskId}/accept`, data); },
  verificationResults(taskId) { return this.get(`/tasks/${taskId}/verification-results`); },

  // Export
  exportJson(taskId) { return this.post(`/tasks/${taskId}/export/json`); },
  exportMl(taskId) { return this.post(`/tasks/${taskId}/export/ml`); },
  exportReport(taskId) { return this.post(`/tasks/${taskId}/export/report`); },
  exports(taskId) { return this.get(`/tasks/${taskId}/exports`); },
  exportUrl(id) { return `${this.base}/tasks/exports/${id}`; },

  // Скачивание файла с авторизационным заголовком
  async downloadFile(path, filename) {
    const res = await fetch(this.base + path, { headers: { Authorization: `Bearer ${this.token()}` } });
    if (!res.ok) throw new Error('Не удалось скачать файл');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  downloadExport(id, filename) { return this.downloadFile(`/tasks/exports/${id}`, filename); },
  downloadTermsExport(projectId) { return this.downloadFile(`/terms/project/${projectId}/export/download`, `terms_project_${projectId}.json`); },

  // Analytics
  projectAnalytics(projectId) { return this.get(`/analytics/project/${projectId}`); },
  usersAnalytics() { return this.get('/analytics/users'); },
  qualityMetrics() { return this.get('/analytics/quality'); },
  termsAnalytics() { return this.get('/analytics/terms'); },

  // Admin
  adminUsers() { return this.get('/admin/users'); },
  assignableUsers() { return this.get('/admin/users/assignable'); },
  adminCreateUser(data) { return this.post('/admin/users', data); },
  adminUpdateUser(id, data) { return this.put(`/admin/users/${id}`, data); },
  roles() { return this.get('/admin/roles'); },
  audit() { return this.get('/admin/audit'); },
  assignmentHistory() { return this.get('/admin/assignment-history'); },

  // AI
  hints(taskId) { return this.get(`/ai/hints/${taskId}`); },
  suggestions(taskId) { return this.get(`/ai/suggest/${taskId}`); },
};
