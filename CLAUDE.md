# GandolaChat — Project Context

## Что это
Discord-подобный десктопный мессенджер для общения с друзьями (до ~50 человек).
Личный проект пользователя Gandola.

## Стек
- **Клиент**: Electron + React + TypeScript (Vite)
- **Сервер**: Python + FastAPI (REST + WebSockets)
- **БД**: PostgreSQL (через SQLAlchemy async)
- **Видеозвонки**: WebRTC (simple-peer)
- **Авторизация**: JWT + bcrypt (email + пароль)
- **Хостинг**: VPS (~$6/мес), Docker Compose

## Структура
```
gandola-chat/
├── server/
│   ├── app/
│   │   ├── main.py          ← FastAPI app + WebSocket роут + планировщик очистки сообщений
│   │   ├── config.py        ← Settings (DATABASE_URL, SECRET_KEY, и др.)
│   │   ├── database.py      ← SQLAlchemy async engine
│   │   ├── models.py        ← User, Chat, Message (chat_members association table)
│   │   ├── schemas.py       ← Pydantic схемы
│   │   ├── auth.py          ← JWT create/verify, get_current_user dependency
│   │   ├── api/
│   │   │   ├── auth.py      ← POST /api/auth/register, /api/auth/login
│   │   │   ├── users.py     ← GET /api/users/me, /api/users/search, POST /api/users/avatar
│   │   │   └── chats.py     ← GET/POST /api/chats, /api/chats/dm, /api/chats/group, messages, files
│   │   └── ws/
│   │       ├── manager.py   ← ConnectionManager (WebSocket connections + chat rooms)
│   │       └── handler.py   ← WebSocket endpoint (сообщения + WebRTC сигналинг)
│   ├── Dockerfile
│   └── requirements.txt
├── client/
│   ├── src/
│   │   ├── main/
│   │   │   ├── main.ts      ← Electron main process (frameless window, IPC)
│   │   │   └── preload.ts   ← contextBridge (window controls)
│   │   └── renderer/
│   │       ├── index.html
│   │       ├── index.tsx
│   │       ├── App.tsx      ← Роутинг Auth/Main, проверка токена
│   │       ├── pages/
│   │       │   ├── Auth.tsx ← Форма входа/регистрации
│   │       │   └── Main.tsx ← Главная (titlebar + sidebar + chatarea + memberlist)
│   │       ├── components/
│   │       │   ├── Sidebar.tsx    ← Список чатов, поиск пользователей, создание групп, аватарка
│   │       │   ├── ChatArea.tsx   ← Переписка, загрузка файлов, входящий звонок
│   │       │   ├── MemberList.tsx ← Участники группового чата, добавление
│   │       │   └── VideoCall.tsx  ← Видеозвонок (WebRTC, до 7 чел)
│   │       ├── services/
│   │       │   ├── api.ts         ← axios клиент, все API вызовы
│   │       │   ├── ws.ts          ← WebSocket сервис с авто-реконнектом
│   │       │   └── webrtc.ts      ← WebRTC через simple-peer
│   │       └── styles/
│   │           └── global.css     ← Discord-like тёмная тема (CSS переменные)
│   ├── .env                 ← VITE_API_URL, VITE_WS_URL (менять при деплое)
│   ├── .env.example
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── tsconfig.main.json
├── docker-compose.yml       ← db (postgres:16) + server
└── README.md                ← Инструкция по запуску и деплою

```

## Функциональность
- Регистрация / вход по email
- Личные чаты (DM) и групповые (до 7 человек)
- Видеозвонки до 7 человек (WebRTC через simple-peer)
- Загрузка файлов и изображений (до 50MB)
- Аватарки пользователей
- Сообщения хранятся 2 дня (авто-очистка каждый час)
- Тёмная тема в стиле Discord
- Frameless окно с кастомным тайтлбаром
- .exe установщик через electron-builder

## WebSocket события
- `message` — новое сообщение в чат
- `new_chat` — пользователю создали новый чат
- `call_signal` — WebRTC сигналинг (offer/answer/candidate)
- `call_end` — завершение звонка

## Что ещё НЕ сделано (можно добавить)
- Иконка приложения (нужен `client/assets/icon.ico`)
- HTTPS / nginx reverse proxy для продакшна
- Уведомления о новых сообщениях
- Индикатор "печатает..."
- Прочитанные / непрочитанные сообщения

## Следующие шаги (на момент создания)
1. Установить инструменты: Node.js 20+, Python 3.12, Docker Desktop
2. Запустить PostgreSQL через Docker
3. Запустить сервер: `cd server && pip install -r requirements.txt && uvicorn app.main:app --reload`
4. Запустить клиент: `cd client && npm install && npm run dev`
5. Протестировать локально
6. Добавить иконку (`client/assets/icon.ico`)
7. Арендовать VPS, задеплоить через `docker-compose up -d`
8. Поменять IP в `client/.env`, собрать `npm run dist` → `.exe`

## Пользователь
- Знает Java, Python, Playwright
- Windows 11
- Проект только для Windows (пока)
