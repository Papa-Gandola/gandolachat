# GandolaChat

Свой мессенджер для чата друзей: Discord-подобный, со звонками, покером и
сезонным компендиумом по Dota 2. Живёт на собственном VPS, данные — только у нас.

## Возможности

- Личные сообщения и групповые чаты (группы до 7 человек), реакции, ответы,
  редактирование, пересылка, поиск, «печатает…», прочитанность
- Сообщения хранятся **вечно** (чистка — только вручную админом)
- Видеозвонки до 7 человек (WebRTC + свой TURN), шаринг экрана
- Файлы и картинки до 50 МБ (альбомы-мозаики), аватарки
- **Покер** — sit-and-go турниры прямо в чате, со шпаргалкой комбинаций
  и подсказчиком шансов банка
- **/dota** — карточка «Газуем в дотан» с кнопкой запуска игры и списком готовых
- **Гандолиум** — сезонный компендиум по рейтинговым каткам Dota 2:
  привязка Steam, звание в профиле, 70 авто-заданий (ежедневки, еженедельки,
  марафоны, командные, анти-ачивки, пасхалки), газ ⛽, уровни, косметика
  (титулы, цвета ников, рамки), таблица сезона и полка трофеев
- Две темы: Discord-стайл и «neo» (моно-шрифт, кастомные цвета)
- Регистрация с одобрением админа; пуш-уведомления на телефон
- Клиенты: Windows (.exe), веб, iPhone/Android как PWA («На экран Домой»)

## Быстрый старт (разработка)

```bash
# Сервер (нужен PostgreSQL)
docker run -d --name pg -e POSTGRES_USER=gandola -e POSTGRES_PASSWORD=gandola \
  -e POSTGRES_DB=gandolachat -p 5432:5432 postgres:16-alpine
cd server && pip install -r requirements.txt && uvicorn app.main:app --reload

# Десктоп-клиент
cd client && npm install && npm run dev

# Мобилка (Expo)
cd mobile && npm install && npm start
```

Миграции БД накатываются сами при старте сервера.

## Прод

VPS + Docker Compose (`db` + `server`), сверху — хостовый **nginx с
Let's Encrypt**: наружу только `https://…` / `wss://…`, порт 8000 закрыт.
Звонки ходят через системный **coturn** (диапазон портов должен совпадать
с правилами ufw). Секрет: `SECRET_KEY` в окружении (менять нельзя —
разлогинит всех).

Обновление сервера:

```bash
git pull && docker compose build server && docker compose up -d server
```

Обновление PWA: `cd mobile && npm run build:web` → содержимое `mobile/dist/`
скопировать в `server/web/` (bind-mount, рестарт не нужен).

## Релизы десктопа

Версия задаётся в `client/package.json` (и в шапке `Main.tsx`). После мержа
в main:

```bash
git tag v2.x.x && git push origin v2.x.x
```

GitHub Actions соберёт **черновик** релиза (Linux создаёт, Windows докладывает
.exe) — останется нажать *Publish release*. Автообновление подхватит само.
Нативный Android собирается тегом `mobile-v*` (EAS), версия у мобилки своя.

## Структура проекта

```
gandolachat/
├── server/                 # FastAPI + SQLAlchemy async + PostgreSQL
│   ├── app/
│   │   ├── main.py         # Точка входа, статика, планировщик джоб
│   │   ├── models.py       # БД: юзеры, чаты, покер, компендиум
│   │   ├── api/            # REST: auth, users, chats, poker, dota, compendium
│   │   ├── ws/             # WebSocket: чат, звонки, покер, сигналинг
│   │   ├── compendium/     # Гандолиум: задания, движок, поллер OpenDota
│   │   ├── poker_*.py      # Покерный движок
│   │   └── opendota.py     # Клиент OpenDota API
│   ├── alembic/            # Миграции
│   └── assets/             # Видео-тизер Гандолиума
├── client/                 # Десктоп: Electron + React + Vite
│   └── src/renderer/       # pages/, components/, services/
├── mobile/                 # Android + веб-PWA: Expo / React Native
└── docker-compose.yml
```

Подробная карта проекта для разработки — в `CLAUDE.md`.
