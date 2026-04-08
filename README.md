# GandolaChat

Discord-подобный мессенджер для общения с друзьями.

## Возможности
- Личные сообщения и групповые чаты (до 7 человек)
- Видеозвонки (до 7 человек) через WebRTC
- Загрузка файлов и аватарок
- Тёмная тема в стиле Discord
- Сообщения хранятся 2 дня

---

## Быстрый старт (разработка)

### 1. Запуск сервера

```bash
cd server
pip install -r requirements.txt
# Нужен PostgreSQL. Запусти через Docker:
docker run -d --name pg -e POSTGRES_USER=gandola -e POSTGRES_PASSWORD=gandola -e POSTGRES_DB=gandolachat -p 5432:5432 postgres:16-alpine
uvicorn app.main:app --reload
```

### 2. Запуск клиента

```bash
cd client
npm install
npm run dev
```

---

## Деплой на VPS (продакшн)

### На сервере:

```bash
# Установить Docker и Docker Compose
curl -fsSL https://get.docker.com | sh

# Клонировать/залить проект
git clone <your-repo> gandola-chat
cd gandola-chat

# Задать секретный ключ
export SECRET_KEY="your-super-secret-key-min-32-chars"

# Запустить
docker-compose up -d
```

Сервер будет доступен на порту **8000**.

---

## Сборка .exe для Windows

1. Отредактируй `client/.env`:
   ```
   VITE_API_URL=http://YOUR_VPS_IP:8000
   VITE_WS_URL=ws://YOUR_VPS_IP:8000
   ```

2. Собери установщик:
   ```bash
   cd client
   npm install
   npm run dist
   ```

3. Установщик появится в `client/release/GandolaChat Setup.exe`

Раздай `.exe` друзьям — они просто устанавливают и заходят!

---

## Структура проекта

```
gandola-chat/
├── server/                 # FastAPI бэкенд
│   ├── app/
│   │   ├── main.py         # Точка входа
│   │   ├── models.py       # БД модели
│   │   ├── schemas.py      # Pydantic схемы
│   │   ├── auth.py         # JWT авторизация
│   │   ├── api/            # REST роуты
│   │   └── ws/             # WebSocket + WebRTC сигналинг
│   └── Dockerfile
├── client/                 # Electron + React
│   ├── src/
│   │   ├── main/           # Electron процесс
│   │   └── renderer/       # React UI
│   │       ├── pages/      # Auth, Main
│   │       ├── components/ # Sidebar, ChatArea, VideoCall...
│   │       └── services/   # api.ts, ws.ts, webrtc.ts
│   └── package.json
└── docker-compose.yml
```
