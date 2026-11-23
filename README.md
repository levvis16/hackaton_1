# Gecko Next — сервис аудио/видеоразметки

Веб-платформа для разметки, верификации и контроля качества речевых данных.
Backend — **FastAPI + SQLAlchemy + SQLite**, frontend — SPA на ванильном JavaScript
(без сборки), интерфейс на русском языке.

Проект реализует обязательный и расширенный MVP из технического задания хакатона
«Сервис аудио/видеоразметки Gecko Next».

---

## 1. Возможности

### Обязательный MVP
- Регистрация и вход по JWT, роли: администратор, супервайзер, разметчик, верификатор, ML-инженер, заказчик.
- Загрузка аудио (`.wav`, `.mp3`, `.ogg`, `.flac`, `.m4a`) и предразметки в JSON.
- Отрисовка **waveform** на `<canvas>` с линейкой времени, зумом и мини-навигацией.
- Воспроизведение аудио: play/pause, скорость 0.5–1.5×, отступ (padding) до/после сегмента, режим «цикл».
- Список сегментов, создание / удаление / **разделение** / **объединение**, редактирование текста и границ.
- Перетаскивание границ сегментов мышью прямо на waveform (точность 0.01 с) и snap-to-speech.
- Поле текста сегмента с **undo/redo** (Ctrl+Z / Ctrl+Y).
- **Автосохранение** изменений не реже 5 секунд (фактически ~1.2 с после последнего ввода).
- Экспорт разметки в JSON, ML-формат и текстовый отчёт.
- Роли «разметчик» и «верификатор», чек-лист перед отправкой на проверку.

### Расширенный MVP
- Видео и синхронное воспроизведение видео + waveform (+ видео-панель в рабочем месте).
- Комментарии верификатора по категориям и возврат задачи на доработку.
- Терминологический словарь: спорные термины, варианты написания, approve/reject, импорт/экспорт.
- Автопроверки качества: короткие/длинные сегменты, пустой текст, наложение, обрезанная речь, термины.
- AI-подсказки (эвристический ассистент) и отдельный эндпоинт suggest.
- История изменений сегментов и версий транскрипта с откатом.
- Горячие клавиши (Space, Enter, `[`/`]`, `S`, `C`, `+`/`-`, Ctrl+S, Ctrl+Z/Y).
- Статусы задач: новая → назначена → в работе → на проверке → на доработке → исправлена → принята → выгружена.
- Базовая аналитика: по проекту, по исполнителям, по качеству, по терминам.
- Администрирование: пользователи, роли, блокировка, журнал аудита, история назначений.

---

## 2. Структура проекта

```
vuz_practice/
├── backend/
│   ├── app/
│   │   ├── main.py            # точка входа FastAPI, монтирование /api и статики
│   │   ├── config.py          # настройки, роли, статусы, пути
│   │   ├── database.py        # SQLAlchemy engine / сессии
│   │   ├── models.py          # ORM-модели
│   │   ├── schemas.py         # Pydantic-схемы
│   │   ├── security.py        # хэш паролей, JWT
│   │   ├── deps.py            # зависимости авторизации (роли, token-or-header)
│   │   ├── seed.py            # демо-данные (пользователи, проект, задача, аудио, термины)
│   │   ├── routers/           # auth, projects, tasks, media, segments, transcripts,
│   │   │                      # terms, verification, export, analytics, admin, ai
│   │   └── services/          # waveform, checks, ai_assistant, export_service, audit
│   └── data/                  # gecko.db, uploads/, exports/ (создаётся автоматически)
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js         # API-клиент (JWT, token в query для медиа)
│       ├── app.js         # SPA-роутер, утилиты, дашборд
│       ├── auth.js        # вход / регистрация
│       ├── projects.js    # проекты
│       ├── tasks.js       # задачи (список, создание, карточка, экспорт)
│       ├── annotator.js   # рабочее место разметчика (waveform, сегменты, автосохранение)
│       ├── verifier.js    # кабинет верификатора (сравнение, комментарии, приёмка)
│       ├── terms.js       # терминологический модуль
│       ├── analytics.js   # аналитика
│       └── admin.js       # администрирование
├── requirements.txt
├── README.md
└── Задание_2_хакатон_сервис_аудио_видеоразметки_Gecko_Next.pdf
```

---

## 3. Запуск

### Требования
- Python 3.10+ (проверено на 3.13)
- Node.js не требуется (frontend без сборки)

### Установка
```powershell
# из корня проекта
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Запуск сервера
```powershell
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Откройте в браузере: **http://127.0.0.1:8000**

При первом запуске автоматически:
1. создаётся база `backend/data/gecko.db` и структура таблиц;
2. генерируется демо-аудио `backend/data/uploads/demo_meeting.wav` (30 с);
3. создаются роли, пользователи, демо-проект, задача, 8 сегментов и 11 терминов.

Интерактивная документация API: **http://127.0.0.1:8000/docs**

### Демо-аккаунты

| Роль           | Email                     | Пароль     |
|----------------|---------------------------|------------|
| Администратор  | `admin@gecko.local`       | `admin123` |
| Супервайзер    | `supervisor@gecko.local`  | `super123` |
| Разметчик      | `annotator@gecko.local`   | `annot123` |
| Верификатор    | `verifier@gecko.local`    | `verif123` |
| ML-инженер     | `ml@gecko.local`          | `ml12345`  |
| Заказчик       | `customer@gecko.local`    | `cust123`  |

### Сброс демо-данных
Остановите сервер, удалите `backend/data/gecko.db` и запустите снова — база и демо-данные пересоздадутся.

Переменные окружения (необязательно):
- `GECKO_DATA_DIR` — каталог данных (по умолчанию `backend/data`);
- `GECKO_SECRET_KEY` — ключ подписи JWT.

---

## 4. Как пользоваться (типовой сценарий)

1. Войти как **разметчик** → «Задачи» → открыть задачу → кнопка «▶ Разметить» (рабочее место).
2. Прослушать запись, поправить границы прямо на waveform (перетаскивание краёв) и текст сегментов.
   Изменения сохраняются автоматически (индикатор «Сохранено»).
3. Разобрать панели справа: **AI-подсказки**, **автопроверки**, **термины**, **замечания**, **чек-лист**.
4. Отметить пункты чек-листа и нажать «Отправить на проверку» (при критических ошибках отправка блокируется).
5. Войти как **верификатор** → «Проверить» → сравнить с предразметкой, добавить замечания,
   вернуть на доработку или принять. Задача при необходимости возвращается разметчику.
6. **Супервайзер** / **администратор**: аналитика, экспорт, назначение исполнителей, управление словарём.
7. Экспорт: карточка задачи → блок «Экспорт» → JSON / ML / отчёт (файл скачивается).

### Горячие клавиши в рабочем месте
| Клавиша | Действие |
|---|---|
| `Space` | воспроизведение / пауза |
| `Enter` | воспроизвести выделенный сегмент |
| `[` / `]` | предыдущий / следующий сегмент |
| `S` | разделить сегмент по курсору |
| `C` | пометить сегмент проверенным |
| `+` / `-` | зум waveform |
| `←` / `→` | сдвиг курсора (с `Shift` — по 1 с) |
| `Ctrl+S` | сохранить сейчас |
| `Ctrl+Z` / `Ctrl+Y` | отменить / повторить правку текста |

---

## 5. Основные эндпоинты API (префикс `/api`)

**Аутентификация** `auth`
`POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /auth/me`

**Проекты** `projects`
`GET|POST /projects`, `GET|PUT|DELETE /projects/{id}`

**Задачи** `tasks`
`GET|POST /tasks`, `GET /tasks/{id}`, `PUT /tasks/{id}/status`, `POST /tasks/{id}/assign`,
`POST /tasks/{id}/start`, `POST /tasks/{id}/submit`,
`GET|PUT /tasks/{id}/checklist`, `GET /tasks/{id}/quality-checks`

**Медиа** `media`
`GET /media`, `POST /media/upload`, `GET /media/{id}`, `GET /media/{id}/info`,
`GET /media/{id}/waveform`, `DELETE /media/{id}`
(файл и waveform доступны по заголовку `Authorization` **или** query `?token=` для `<audio>/<video>`)

**Сегменты** `segments`
`GET /segments/task/{task_id}`, `POST /segments`, `PUT|DELETE /segments/{id}`,
`POST /segments/{id}/split`, `POST /segments/merge`, `POST /segments/task/{id}/import`

**Транскрипт** `transcripts`
`GET /tasks/{task_id}/transcript`, `GET /tasks/{task_id}/versions`, `POST /tasks/{task_id}/restore`,
`GET /tasks/{task_id}/source-segments`, `GET /tasks/{task_id}/segment-edits`

**Верификация** `verification`
`POST|GET /tasks/{task_id}/comments`, `PUT /tasks/comments/{id}/resolve`,
`POST /tasks/{task_id}/return`, `POST /tasks/{task_id}/accept`, `GET /tasks/{task_id}/verification-results`

**Термины** `terms`
`GET /terms/project/{id}`, `POST /terms`, `PUT /terms/{id}`, `POST /terms/{id}/approve`,
`POST /terms/{id}/reject`, `POST /terms/project/{id}/import`,
`GET /terms/project/{id}/export`, `GET /terms/project/{id}/export/download`

**Экспорт** `export`
`POST /tasks/{id}/export/json`, `POST /tasks/{id}/export/ml`, `POST /tasks/{id}/export/report`,
`GET /tasks/{id}/exports`, `GET /tasks/exports/{id}`

**Аналитика** `analytics`
`GET /analytics/project/{id}`, `GET /analytics/users`, `GET /analytics/quality`, `GET /analytics/terms`

**Администрирование** `admin`
`GET|POST /admin/users`, `PUT /admin/users/{id}`, `GET /admin/users/assignable`,
`GET /admin/roles`, `GET /admin/audit`, `GET /admin/assignment-history`

**AI-ассистент** `ai`
`GET /ai/hints/{task_id}`, `GET /ai/suggest/{task_id}`

**Служебное**
`GET /api/health`

---

## 6. Нефункциональные требования

- **Точность границ** — 0.01 с (границы хранятся и редактируются с округлением до сотых).
- **Автосохранение** — не реже 5 секунд (реализовано ~1.2 с дебаунсом после правки).
- **Браузеры** — Chrome, Edge, Firefox (используются стандартные Web API, без препроцессоров).
- **Стек** — FastAPI + SQLAlchemy + SQLite (MVP), хранение файлов в локальной ФС.

---

## 7. Ограничения MVP

- Автопроверки и AI-подсказки — эвристические (без внешних ML-сервисов).
- Waveform рассчитывается только для WAV; для других форматов строится базовая линия.
- Асинхронной обработки/очередей нет — задачи обрабатываются синхронно.
