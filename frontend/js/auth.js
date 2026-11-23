/* ===== Авторизация: вход и регистрация ===== */
const Auth = {
  render(hash) {
    const view = document.getElementById('auth-view');
    if (hash.includes('register')) {
      view.innerHTML = this.registerHtml();
    } else {
      view.innerHTML = this.loginHtml();
    }
    this.bind();
  },

  loginHtml() {
    return `
      <div class="auth-card">
        <h1>🎙️ Gecko <span style="color:var(--accent)">Next</span></h1>
        <div class="sub">Сервис аудио/видеоразметки, верификации и контроля качества</div>
        <form id="login-form">
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="login-email" value="annotator@gecko.local" required>
          </div>
          <div class="form-group">
            <label>Пароль</label>
            <input type="password" id="login-password" value="annot123" required>
          </div>
          <button type="submit" class="btn btn-block">Войти</button>
        </form>
        <div class="auth-switch">Нет аккаунта? <a onclick="App.navigate('/register')">Зарегистрироваться</a></div>
        <div class="demo-accounts">
          <b>Демо-аккаунты:</b><br>
          Админ: <code>admin@gecko.local / admin123</code><br>
          Супервайзер: <code>supervisor@gecko.local / super123</code><br>
          Разметчик: <code>annotator@gecko.local / annot123</code><br>
          Верификатор: <code>verifier@gecko.local / verif123</code>
        </div>
      </div>
    `;
  },

  registerHtml() {
    return `
      <div class="auth-card">
        <h1>Регистрация</h1>
        <div class="sub">Создайте аккаунт в Gecko Next</div>
        <form id="register-form">
          <div class="form-group">
            <label>ФИО</label>
            <input type="text" id="reg-name" required>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="reg-email" required>
          </div>
          <div class="form-group">
            <label>Пароль</label>
            <input type="password" id="reg-password" minlength="6" required>
          </div>
          <div class="form-group">
            <label>Роль</label>
            <select id="reg-role">
              <option value="annotator">Разметчик</option>
              <option value="verifier">Верификатор</option>
              <option value="supervisor">Супервайзер</option>
              <option value="ml_engineer">ML-инженер</option>
              <option value="customer">Заказчик</option>
            </select>
          </div>
          <button type="submit" class="btn btn-block">Создать аккаунт</button>
        </form>
        <div class="auth-switch">Уже есть аккаунт? <a onclick="App.navigate('/login')">Войти</a></div>
      </div>
    `;
  },

  bind() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const data = await API.login(
            document.getElementById('login-email').value,
            document.getElementById('login-password').value
          );
          API.setToken(data.access_token);
          App.user = data.user;
          toast(`Добро пожаловать, ${data.user.full_name}!`, 'success');
          App.navigate('/');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }

    const regForm = document.getElementById('register-form');
    if (regForm) {
      regForm.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const data = await API.register({
            full_name: document.getElementById('reg-name').value,
            email: document.getElementById('reg-email').value,
            password: document.getElementById('reg-password').value,
            role: document.getElementById('reg-role').value,
          });
          API.setToken(data.access_token);
          App.user = data.user;
          toast('Аккаунт создан!', 'success');
          App.navigate('/');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  },
};
