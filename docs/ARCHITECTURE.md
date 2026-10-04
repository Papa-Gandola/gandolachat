# GandolaChat — полная карта проекта

Документ для любого человека или нейросети, которому нужно разобраться в
проекте с нуля: что это, как устроено, где что лежит, как деплоится и на
какие грабли уже наступали. Он описывает **код в репозитории на момент
правки** (см. дату внизу), а не планы. Если меняешь поведение — обнови
соответствующий раздел здесь. Более сжатые и свежие рабочие заметки
агента (решения хозяина, история, грабли) — в `CLAUDE.md`; короткий
свод правил для агентов — в `AGENTS.md`.

Содержание:

1. [Что это и для кого](#1-что-это-и-для-кого)
2. [Словарь](#2-словарь)
3. [Структура репозитория](#3-структура-репозитория)
4. [Прод-топология](#4-прод-топология)
5. [Рабочий цикл, деплой, релизы](#5-рабочий-цикл-деплой-релизы)
6. [Сервер](#6-сервер)
7. [Гандолиум (компендиум Dota 2)](#7-гандолиум-компендиум-dota-2)
8. [Десктоп-клиент](#8-десктоп-клиент)
9. [Мобильное приложение и PWA](#9-мобильное-приложение-и-pwa)
10. [Звонки: сквозная картина](#10-звонки-сквозная-картина)
11. [Уведомления: сквозная картина](#11-уведомления-сквозная-картина)
12. [Сборка, CI/CD](#12-сборка-cicd)
13. [Локальная проверка и тесты](#13-локальная-проверка-и-тесты)
14. [Ловушки, на которые уже наступали](#14-ловушки-на-которые-уже-наступали)
15. [История ключевых решений](#15-история-ключевых-решений)
16. [Бэклог и отложенное](#16-бэклог-и-отложенное)
17. [Как поддерживать этот документ](#17-как-поддерживать-этот-документ)

---

## 1. Что это и для кого

**GandolaChat** — самодельный мессенджер «как Discord» для одной компании
друзей. Личный проект Гандолы (GitHub: Papa-Gandola; в коде и заметках —
«хозяин»). Он сам мержит PR, сам деплоит на свой VPS и сам принимает все
продуктовые решения. Общение в задачах, коммитах, документации и
интерфейсе — **по-русски**; хозяин сидит на Windows 11, знает Java и
Python.

Масштаб: реально активных людей 9–10; ёмкость закладывается с запасом
«на друзей и родственников» ~50. Это важно для лимитов: OpenDota
(бесплатный тариф), пуши, покер — всё считается от десятка людей, но
решения не должны ломаться при росте до пятидесяти.

Три клиента на один сервер:

- **Десктоп** (Windows, также Linux): Electron + React + Vite. Основной
  клиент хозяина.
- **Мобилка** (Android, нативный APK): Expo SDK 57 / React Native 0.86.
- **PWA** (iPhone через «Добавить на экран Домой», браузер на компе): та же
  кодовая база, что мобилка, собранная под веб; раздаётся сервером по
  `/app/`.

Что умеет (кратко; детали в разделах ниже):

- ЛС и группы (до 7 человек), режим «канала» (пишет только создатель),
  реакции, ответы, правка, пересылка, поиск, «печатает…», прочитанность
  между устройствами, закрепы, опросы с дописыванием вариантов.
- Файлы: фото (мозаика альбомов), видео до 50 МБ с плеером, голосовые
  с телефона с плеером на десктопе, прочие файлы до 10 МБ.
- Звонки до 7 человек: WebRTC mesh через свой coturn, камера, экран с
  компа и с телефона, вход в идущий созвон, многоустройственность.
- Покер: sit-and-go турниры прямо в чате, режим «за газ» (ставка из
  Гандолиума), история раздач, шпаргалка и подсказчик шансов.
- Гандолиум: сезонный (месячный) компендиум по рейтинговым каткам Dota 2:
  привязка Steam, 108 заданий (ежедневки, недельные, марафоны, командные,
  анти-ачивки, пасхалки), газ ⛽ → уровни до 30, косметика ников, ставки
  газом на катки, финал сезона с подиумом и призом от хозяина, бинго
  тайных ачивок, хеллоуинская тема в октябре.
- «Заметки» (личный чат с собой) с напоминаниями, карточка «/dota»
  («газуем в дотан» со списком готовых), значок «сейчас в Доте».
- Регистрация с одобрением админа, пуши (Expo для Android, Web Push для
  PWA/iPhone), кнопка «Нашёл баг» — логи приложения файлом хозяину в ЛС.

Сообщения **вечные**: никакого автоудаления; чистку делает только админ
кнопкой «удалить до даты».

## 2. Словарь

| Термин | Значение |
|---|---|
| Хозяин | Papa-Gandola, владелец проекта, единственный, кто мержит и деплоит |
| Гандолиум, компендиум | Сезонная система заданий по Dota 2 (`server/app/compendium/`) |
| Газ ⛽ | Очки Гандолиума. Копятся за задания, тратятся на ставки и покер «за газ». Значок — именно эмодзи ⛽ (хозяин настоял) |
| Уровень | Функция от газа ЗА СЕЗОН по шкале сезона (см. §7). Косметика открывается по уровню лучшего сезона (`comp_max_level`) |
| Сезон | Календарный месяц по МСК (UTC+3 фиксированно). Ключ вида `"2026-10"` |
| Катка | Рейтинговый матч Dota 2 (lobby_type=7). Другие режимы не считаются |
| 📼, «парс» | Матч разобран OpenDota (replay parsed): доступны варды, руны, дымы, мультикиллы и т.п. Задания с `needs_parse` ждут парса |
| Карточка | Служебное сообщение в чат с JSON-маркером: `/quest_card {...}` (выполнение задания, анти-ачивка, командное, итоги недели, финал сезона, ставки), `/poll N` (опрос), `/dota_call`, `/poker_table N`, `/call_record ...`, `/reminder {...}`. Клиенты рендерят их как виджеты |
| Маркер | Текст сообщения, начинающийся с `/что-то` — признак карточки. Серверные маркеры (`/quest_card`, `/poll`) защищены от подделки: сервер режет их из пользовательских сообщений |
| ЛС | Личный чат на двоих (`is_group=False`). Имени у чата нет, показывается ник собеседника |
| Группа | Чат до 7 участников с создателем, админами (`admin_ids`), описанием, аватаркой |
| Канал | Группа с `allow_all_write=False`: пишет только создатель |
| Заметки | Личный чат с одним участником (`is_notes=True`) — заметки, файлы, напоминания |
| Созвон | Звонок в чате; состав («кто в созвоне») ведёт сервер в памяти |
| mesh | Топология звонка: каждый участник держит P2P-соединение с каждым (до 7) |
| tie-break | Правило, кто из двух участников шлёт WebRTC-оффер: меньший user_id |
| TURN / coturn | Релей для звонков, когда напрямую через NAT не пробиться; системный сервис на VPS |
| OTA | Обновление JS мобилки «по воздуху» (EAS Update) без нового APK |
| runtimeVersion | Метка нативной сборки мобилки; OTA долетает только до сборок с тем же значением |
| Грабли | Уже случившиеся поломки с выводами (§14 и `CLAUDE.md`) |
| scratchpad | Временная папка агента вне репозитория (тесты, скриншоты, скрипты Playwright); в репо не попадает |

## 3. Структура репозитория

```
gandolachat/
├── AGENTS.md               # вход для агентов: куда смотреть, правила
├── CLAUDE.md               # рабочие заметки агента: история, грабли, бэклог
├── README.md               # короткое описание для людей
├── docs/ARCHITECTURE.md    # этот документ
├── docker-compose.yml      # прод: db (postgres:16) + server
├── docker-compose.dev.yml  # дев-вариант compose
├── .env.example            # переменные для .env рядом с compose
├── coturn/turnserver.conf  # эталон конфига coturn (сам сервис живёт на VPS)
├── .github/workflows/
│   ├── release.yml         # десктоп: тег v* → черновик релиза (Linux, затем Windows)
│   ├── mobile-release.yml  # Android: APK через EAS → релиз mobile-latest
│   └── mobile-ota.yml      # Android: OTA-обновление JS через EAS Update
├── server/                 # FastAPI + SQLAlchemy 2.0 async + PostgreSQL
│   ├── Dockerfile          # python:3.12-slim-bookworm + pg_dump из postgres:16-bookworm
│   ├── requirements.txt
│   ├── alembic.ini, alembic/versions/  # миграции 0001…0016
│   ├── assets/compendium/intro.mp4     # заставка Гандолиума (копируется в uploads)
│   ├── web/                # bind-mount: собранная PWA (в git не хранится)
│   └── app/
│       ├── main.py         # приложение, статика, WS-роут, планировщик
│       ├── config.py       # Settings из env/.env
│       ├── database.py     # движок и сессии
│       ├── models.py       # все таблицы
│       ├── schemas.py      # Pydantic-модели ответов
│       ├── auth.py         # bcrypt + JWT
│       ├── api/            # REST: auth, users, chats, dota, poker, polls, compendium, bugreport
│       ├── ws/             # manager.py (сокеты, составы звонков), handler.py (события)
│       ├── compendium/     # Гандолиум: quests, engine, poller, bets, weekly, finale, prizes, halloween
│       ├── poker_engine.py, poker_game.py  # покер: оценка комбинаций, турнир
│       ├── push.py, webpush.py             # Expo и Web Push
│       ├── notes.py        # Заметки и напоминания
│       ├── steam_presence.py               # «в Доте сейчас»
│       ├── opendota.py     # клиент OpenDota (строго IPv4)
│       ├── apk_mirror.py   # зеркало APK на своём VPS
│       ├── backups.py      # ночные дампы + офсайт WebDAV
│       ├── disk.py         # лог места на диске
│       └── uploads_static.py               # отдача файлов с Range
├── client/                 # десктоп: Electron + React + Vite + TypeScript
│   ├── package.json        # версия десктопа, electron-builder
│   ├── scripts/build-twemoji-font.py   # сборка шрифта эмодзи
│   └── src/
│       ├── main/           # процесс Electron: окно, трей, IPC, детект dota2.exe
│       └── renderer/       # React: pages/, components/, services/, assets/
└── mobile/                 # Android + PWA: Expo SDK 57 / RN 0.86
    ├── app.json, app.config.js, eas.json  # версия, versionCode, runtimeVersion, разрешения
    ├── metro.config.js     # веб-стабы нативных модулей
    ├── plugins/            # config-плагины Expo (foreground-сервис звонка, MediaProjection)
    ├── public/             # manifest, sw.js (Web Push), иконки PWA
    ├── scripts/            # postbuild-web.js (префикс /app), patch-webrtc-types.js
    ├── web-stubs/          # заглушки нативных модулей для веба
    └── src/                # navigation/, screens/, components/, services/, theme/, changelog.ts
```

## 4. Прод-топология

- **VPS** (~$6/мес, в РФ). Снаружи только HTTPS/WSS: хостовый **nginx +
  certbot** терминирует TLS для `https://2-26-117-77.sslip.io` и
  проксирует на `localhost:8000`. Порт 8000 наружу закрыт. Конфиги nginx
  и certbot живут на VPS и **в репозитории не хранятся** (проверяя
  поведение прода, помни: «этого нет в репо» ≠ «этого нет»).
  Важное в nginx: `client_max_body_size` ≥ 50m (видео), Range-запросы
  nginx сам не подкладывает (сервер отдаёт файлы с Range сам).
- **Docker Compose** (`docker-compose.yml`): сервис `db` (postgres:16,
  том `pgdata`, порт наружу не открыт) и `server` (образ из
  `server/Dockerfile`, `127.0.0.1:8000:8000`). Тома: `uploads:/app/uploads`
  (файлы, аватарки, VAPID-ключи, APK-зеркало, ролик), `backups:/app/backups`
  (дампы БД — отдельный том, потому что uploads публичен), bind
  `./server/web:/app/web` (собранная PWA; деплой PWA = скопировать файлы,
  рестарт не нужен). Переменные окружения сервиса: `DATABASE_URL`,
  `SECRET_KEY` (из `.env`), `BACKUP_WEBDAV_*` (офсайт), `BUG_REPORT_TO`
  (кому слать баг-репорты; дефолт — хозяин).
- **coturn** — системный сервис на VPS (не в docker). Диапазон
  `min-port/max-port` в `/etc/turnserver.conf` обязан совпадать с окном
  ufw (49160–49200); UDP 3478 и, для TURN по TCP, 3478/tcp. Клиенты
  используют его со статической учёткой плюс публичные STUN Google и
  Cloudflare.
- **Секреты**: `SECRET_KEY` подписывает JWT — менять нельзя (разлогинит
  всех). В GitHub Actions: `VITE_API_URL`/`VITE_WS_URL` для сборки
  десктопа (обязательно `https://`/`wss://`), секреты EAS для мобилки.
- **Офсайт бэкапов**: Koofr (WebDAV, не российский — решение хозяина),
  app-пароль; дампы и вложения, бесплатные 10 ГБ.
- Домен — технический через sslip.io (DNS по IP). Это потенциально
  слабое место у некоторых провайдеров (см. §14), своего домена нет.

## 5. Рабочий цикл, деплой, релизы

Цикл: хозяин формулирует задачу → агент делает ветку → PR → хозяин мержит
(часто через считанные минуты, нередко ночью) → хозяин деплоит по таблице.
Ветки хозяин не трогает; «отдельный PR» = отдельная ветка от `main`.
После мержа GitHub удаляет ветку; обычный `git push` на ту же ветку
**молча воссоздаёт её со старой историей** — перед каждым push проверять,
не смержен ли PR, и при необходимости перезапускать ветку от `main`.

Таблица «что менял → что делать» (хозяин выполняет руками):

| Менялось | Действия |
|---|---|
| `server/` | На VPS: `git pull && docker compose build server && docker compose up -d server`. Миграции и синк ассетов — сами при старте. Релиз не нужен. `restart` env не перечитывает — только `up -d`. |
| `client/` | Поднять версию в **двух** местах: `client/package.json` и `APP_VERSION` в `client/src/renderer/changelog.ts` (+ `npm i --package-lock-only`), дописать пункты в `CHANGELOG` там же — окно «Что нового» покажется каждому один раз. После мержа: `git tag v2.x.x && git push origin v2.x.x` → Actions собирает **черновик** релиза (Linux создаёт, Windows докладывает `.exe`, последовательно) → хозяин жмёт Publish. Автообновление десктопа подхватывает опубликованный релиз. |
| `mobile/` (JS) | OTA: push в `main` → workflow `mobile-ota.yml` публикует EAS Update в ветку `preview` (это и есть прод-канал). Телефон ставит при следующем запуске (открыть дважды). При заметном батче поднять `CHANGELOG_ID` (дата) в `mobile/src/changelog.ts` и дописать пункты. |
| `mobile/` (PWA) | На VPS: `cd mobile && npm ci && npm run build:web && rm -rf ../server/web/* && cp -r dist/* ../server/web/`. Node ≥ 20.19. `--clear` в `build:web` обязателен (кэш Metro держит старую версию манифеста). `rm` — иначе копятся старые хэшированные бандлы. |
| `mobile/` (натив) | Изменение `app.json`/`package.json`/`eas.json` в `main` (или тег `mobile-v*`) → `mobile-release.yml` собирает APK в EAS (~1 час) и публикует в скользящий релиз **mobile-latest**; зеркало на VPS подхватывает до 30 мин. Поднимать `version` И `versionCode`; при любом нативном изменении — ещё и `runtimeVersion` (= versionCode той сборки). Тестовая сборка с ветки без публикации: Actions → Mobile Release → Run workflow → `publish=false`. |
| Только docs | Ничего. |

Ошибся тегом: удалить и черновик релиза на GitHub, и тег
(`git tag -d vX && git push origin :refs/tags/vX`), потом заново.
Десктоп-фикс поверх уже выпущенного тега — всегда **новая** версия,
автообновление и «Что нового» ходят по номеру версии.

Версии: десктоп `2.3.x` (сейчас 2.3.17 выпущена, 2.3.18 в PR #86),
мобилка своя `0.9.x` (сборка 11 = 0.9.2, runtimeVersion 9), сервер без
версий (деплоится по `main`).

Коммиты и PR пишутся по-русски, с объяснением «почему», а не только «что».

<!-- SECTION:6-server -->
## 6. Сервер

Код: `server/app/`. Стек: Python 3.12, FastAPI 0.111 (starlette 0.37
прибит им), SQLAlchemy 2.0 async + asyncpg, PostgreSQL 16, Alembic,
APScheduler 3 (AsyncIOScheduler), python-jose (JWT), bcrypt, httpx,
pywebpush, pillow. Запуск: `uvicorn app.main:app --host 0.0.0.0 --port
8000` (CMD в Dockerfile). **Один процесс uvicorn** — всё in-memory
состояние (сокеты, составы звонков, покерные раздачи, присутствие в Доте,
троттлинг пушей) живёт в нём; второй воркер всё сломает.

### 6.1 Старт приложения (`main.py`)

`lifespan`:

1. `alembic upgrade head` в тредпуле (миграции только добавляющие, см.
   §6.4).
2. Синк `assets/compendium/intro.mp4` → `uploads/compendium/intro.mp4`
   (сверка по размеру и sha256).
3. Регистрация джоб планировщика (таблица ниже), `scheduler.start()`.
4. Логи здоровья: `backups.log_health()` (возраст свежего дампа),
   `backups.log_uploads_health()` (возраст синка вложений),
   `disk.log_health()` (размер uploads и свободное место; «МЕСТО
   КОНЧАЕТСЯ» при <2 ГБ).
5. Дополнительный прогон `finalize_season` при каждом старте (джобстор
   in-memory — рестарт поверх крона иначе терял запуск).

Остальное в `main.py`: CORS `*`; `GET /health`; роутер `/uploads/{path}`
(`uploads_static.py`, см. §6.6); REST-роутеры (порядок: auth, users,
chats, poker, dota, compendium, apk_mirror, notes, polls, bugreport);
`app.mount("/app", StaticFiles(directory="web", html=True))` — PWA; WS-роут
`/ws?token=<jwt>`.

В Dockerfile `PYTHONUNBUFFERED=1` — без него `print`-логи появляются в
`docker compose logs` с опозданием. Все логи — `print` с префиксами вида
`[ws]`, `[push]`, `[steam-link]`, `[compendium]`, `[bugreport]`, `[disk]`,
`[backup]`.

**Джобы планировщика** (все UTC; МСК = UTC+3):

| Джоба | Расписание | Что делает |
|---|---|---|
| `cleanup_expired_messages` | каждый час | удаляет только сообщения с выставленным `expires_at` — таких давно не создаётся, фактически no-op |
| `finale.finalize_season` | cron 1-го числа 09:00 UTC (12:00 МСК), misfire 20ч + прогон на старте | закрытие прошлых сезонов Гандолиума (§7.6) |
| `backups.run_backup` | cron 01:00 UTC (04:00 МСК) | `pg_dump -Fc` в том `backups`, ротация 14, офсайт WebDAV |
| `backups.run_uploads_backup` | cron 01:20 UTC | инкрементальный офсайт вложений |
| `weekly.week_recap` | cron Вс 18:00 UTC (21:00 МСК), misfire 2ч | карточка «Итоги недели» |
| `steam_presence.poll_presence` | каждые 120 с | «🎮 в Доте сейчас» через Steam API |
| `notes.fire_due_reminders` | каждые 30 с | срабатывание напоминаний |
| `apk_mirror.sync_apk` | каждые 30 мин, первый сразу | зеркало APK с GitHub |
| `poker.close_stale_tables` | каждые 30 мин, первый через 90 с | снос столов старше 6 ч |
| `poller.poll_matches` | каждые `max(5, DOTA_POLL_MINUTES)` мин | новые катки → задания, ставки |
| `poller.recheck_parses` | каждые 20 мин | дотягивает парс 📼 |
| `poller.refresh_ranks` | каждый час | звания, «Восхождение» |
| `poller.weekly_roast` | cron 00:25 UTC ежедневно, работает только по понедельникам, misfire 20ч | «Дно недели», «Якорь сезона» |

Все джобы компендиума — под общим `asyncio.Lock` (`poller._JOB_LOCK`),
иначе гонки за газ и дубли карточек. `max_instances=1, coalesce=True` у
интервальных.

### 6.2 Конфигурация (`config.py`)

`Settings` (pydantic-settings, читает env и `.env`):

| Поле | Дефолт | Смысл |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://gandola:gandola@localhost:5432/gandolachat` | compose подставляет хост `db` |
| `SECRET_KEY` | плейсхолдер | подпись JWT. **Менять нельзя** — все токены протухнут |
| `ALGORITHM` | `HS256` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 10080 (7 дней) | клиенты обновляют токен через `/api/users/me` при каждом старте |
| `UPLOAD_DIR` | `uploads` | том `uploads` в compose |
| `MAX_FILE_SIZE_MB` | 50 | лимит для видео; прочие файлы — 10 МБ (захардкожено в chats.py) |
| `MESSAGE_TTL_DAYS` | 2 | наследие, к сообщениям не применяется |
| `OPENDOTA_API_KEY` | пусто | опционально, поднимает лимит OpenDota |
| `STEAM_API_KEY` | пусто | нужен для vanity-ссылок Steam и для «в Доте сейчас» |
| `VAPID_SUBJECT` | `https://2-26-117-77.sslip.io` | subject Web Push |
| `DOTA_POLL_MINUTES` | 20 | интервал поллера каток |
| `BACKUP_WEBDAV_URL/USER/PASSWORD` | None | офсайт бэкапов; пусто = только локальные дампы |
| `BUG_REPORT_TO` | пусто | кому слать баг-репорты (compose подставляет «Papa Gandola») |

`BACKUP_DIR` берётся из `os.environ` напрямую в `backups.py` (дефолт
`/app/backups`).

### 6.3 База данных (`database.py`, `models.py`)

Движок `create_async_engine`, `AsyncSessionLocal(expire_on_commit=False)`.
Из-за `expire_on_commit=False` объекты после коммита не протухают — удобно,
но после ручного INSERT повторный `select` вернёт **стейл-объект** из
identity map; перечитка — только с
`.execution_options(populate_existing=True)` (ловушка №1). После `rollback`
в async-сессии обращение к любому атрибуту = `MissingGreenlet` (ловушка
№2): в джобах держать снапшоты примитивов и перечитывать свежим select.

Таблицы (22):

| Таблица | Назначение | Ключевые колонки / ограничения |
|---|---|---|
| `users` | пользователи | `username` unique; `password_hash` (bcrypt); `avatar_url`, `status`(50), `about`(500); `grammar_errors`, `grammar_wk_base`; `is_approved` (регистрация ждёт админа), `is_admin` (только руками в SQL); `last_seen`; Steam: `steam_id64` строкой (не влезает в JS Number), `dota_account_id` BIGINT unique, `dota_rank_tier`, `dota_leaderboard_rank`, `dota_rank_updated_at`, `dota_linked_at`, `dota_presence_visible`; косметика: `comp_max_level`, `comp_badge`, `comp_title`(40), `comp_color`(7), `comp_frame`(16), `comp_extra` JSON |
| `chats` | ЛС, группы, Заметки | `name` (NULL у ЛС), `is_group`, `created_by`, `allow_all_write` (False = канал), `avatar_url`, `description`(1000), `admin_ids` — JSON-строка списка id, `compendium_enabled`, `is_notes`; частичный unique `uq_chats_notes_owner` (одни Заметки на юзера) |
| `chat_members` | состав чата | `(chat_id, user_id)` PK, `joined_at` |
| `messages` | сообщения | `chat_id`, `sender_id`, `content` Text (NULL у чисто файловых), `file_url`, `file_name`, `is_edited`, `reply_to_id` (SET NULL), `created_at` index, `expires_at` (не используется), `media_group_id` (альбом до 10 файлов) |
| `reactions` | реакции | `message_id`, `user_id`, `emoji`(10); уникальности нет и сервер дубли не проверяет — клиенты шлют реакцию как тоггл (поставить/снять) |
| `read_receipts` | прочитанность | `(user_id, chat_id)` PK → `last_read_message_id` |
| `poker_tables` | столы | `status` lobby/playing/finished, `starting_stack` 30000, `starting_small_blind` 100, `starting_big_blind` 200, `blind_increase_minutes` 7, `max_seats` 6, `mode` chips/gas, `entry_gas`, `max_reentries` 2, `reentry_until_level` 3, `gas_pot`, `started_at`, `finished_at` |
| `poker_seats` | места | `table_id`, `user_id`, `seat_index`, `stack`, `is_active`, `reentries`, `gas_paid`; unique `uq_poker_seat_user (table_id, user_id)` |
| `reminders` | напоминания Заметок | `user_id`, `text`(500), `remind_at`, `fired`, `message_id` (карточка `/reminder`) |
| `push_tokens` | Expo-токены | `token` unique (перерегистрация переезжает к текущему юзеру), `platform` |
| `web_push_subscriptions` | Web Push | `endpoint` Text unique, `p256dh`, `auth` |
| `polls`, `poll_options`, `poll_votes` | опросы | `polls.message_id` (носитель `/poll N`), `allow_multi`, `allow_add`, `closed_at`; `poll_options.created_by` (кто дописал); unique `uq_poll_vote (option_id, user_id)` |
| `pinned_messages` | закрепы | unique `uq_pin (chat_id, message_id)` |
| `dota_matches` | катки привязанных | unique `uq_dota_match_user (match_id, user_id)`, `season`, статы (`kills`… `net_worth`), парс-факты (`wards_placed`, `camps_stacked`, `runes_picked`, `multi_kill_max`, `kill_streak_max`, `firstblood`, `lane_role`), `team_key`/`team_size`, `is_parsed`, `parse_attempts`, `data` JSON-текст |
| `compendium_profiles` | кошелёк сезона | unique `(user_id, season)`, `gas`, `start_rank_tier` |
| `quest_completions` | выполнения | unique `(user_id, quest_id, period_key)`, `gas` со знаком, `match_id` |
| `season_results` | архив сезонов | unique `(season, user_id)`, `place`, `username`, `gas`, `level`, `quests_done`, `anti_count` |
| `bets` | ставки | `market`, `side`, `line`, `stake`, `status` open/won/lost/refunded, `match_id`, `progress`, `payout`; частичный unique `uq_bets_open_pair` (одна открытая ставка на пару) |
| `season_prizes`, `season_prize_draws` | призы | пул (`weight`, `active`, `hint1..3`) и розыгрыш на сезон (`season` unique, снапшот названия/подсказок, `revealed`, `winner_*`) |

Каскады: удаление пользователя сносит его сообщения, членства, реакции,
токены, катки, выполнения — поэтому `reject-user` удаляет **только**
неодобренных (гард в `api/auth.py`).

### 6.4 Миграции (`alembic/versions/`)

Только добавляющие, прогоняются сами на старте. 0001 базовая схема; 0002
push_tokens; 0003 компендиум (dota_matches, compendium_profiles,
quest_completions, users.dota_*); 0004 косметика (comp_*); 0005 BIGINT и
unique на `dota_account_id`; 0006 web_push_subscriptions; 0007
`chats.is_notes` + reminders; 0008 season_results; 0009 bets; 0010
`dota_presence_visible` + `grammar_wk_base` с бэкфиллом (иначе первая
карточка «Граммар-наци недели» судила бы по счётчику за всю историю); 0011
пересчёт `comp_max_level` под «уровень лучшего сезона»; 0012 опросы и
закрепы; 0013 настройки покерного стола и режим «за газ»; 0014 призы;
0015 `uq_poker_seat_user` с дедупом; 0016 `users.comp_extra` + срез
`comp_max_level` до 12 (октябрь-2026: новая шкала, «сороковые» сентября не
должны получить косметику 13–30 даром).

### 6.5 Аутентификация (`auth.py`, `api/auth.py`)

- bcrypt для паролей, JWT HS256 с `sub = user_id`, срок 7 дней.
  `get_current_user` — зависимость FastAPI по `Authorization: Bearer`.
- `POST /api/auth/register {username, password}` → пользователь с
  `is_approved=False`, `is_admin=False`; админам по WS летит
  `new_pending_user`. Ответ всегда `{status: "pending", message}` — токена
  при регистрации не бывает (ветка «сервер вернул токен» в мобильном
  RegisterScreen мёртвая).
- `POST /api/auth/login` → 403 до одобрения, 401 при неверном пароле;
  попыток входа сервер не лимитирует.
- `GET /api/auth/pending-users`, `POST /api/auth/approve-user/{id}`,
  `POST /api/auth/reject-user/{id}` — только админ. Reject удаляет только
  неодобренного (см. каскады).
- `POST /api/auth/change-password {old_password, new_password}`.
- Админство — только колонкой `users.is_admin`, ставится руками в SQL.
- `GET /api/users/me` отдаёт `MeOut`: плоские поля юзера + вложенный
  `user` + **свежий `access_token`** — клиенты ротируют токен при каждом
  старте, так семидневный срок на практике не истекает у активных.

### 6.6 REST API

Все пути под `/api/...`, кроме `/health`, `/uploads/...`, `/apk`,
`/apk/info`, `/app/...`. Ошибки — `HTTPException` с русским `detail`
(клиенты показывают его как есть).

**users** (`api/users.py`, `api/bugreport.py`):

| Метод и путь | Что |
|---|---|
| `GET /api/users/me` | профиль + свежий токен |
| `GET /api/users/search?q=` | поиск по нику (видны и неодобренные — см. §6.11) |
| `PATCH /api/users/me` | `username`, `status`, `about`, `dota_presence_visible`; шлёт `profile_updated` |
| `GET /api/users/{id}` | чужой профиль (`UserOut` несёт косметику и `comp_extra`) |
| `POST /api/users/avatar` | multipart, пишет в `uploads/avatars/` |
| `POST /api/users/me/steam {input}` | привязка Steam: `opendota.resolve_link_input` понимает /profiles/id64, /id/vanity (нужен STEAM_API_KEY), ссылки Dotabuff/OpenDota, голый steamID64 или Friend ID. Привязка другого аккаунта удаляет `DotaMatch` юзера; гонка двойной привязки → unique → 400; сетевые ошибки → 502 (`_opendota_error`) |
| `DELETE /api/users/me/steam` | отвязка (чистит `dota_*`) |
| `POST /api/users/me/steam/refresh` | обновить звание |
| `GET /api/users/web-push/key` | публичный VAPID-ключ |
| `POST/DELETE /api/users/web-push` | подписка Web Push `{endpoint, keys{p256dh, auth}}` |
| `POST/DELETE /api/users/push-token` | Expo-токен `{token, platform}` |
| `POST /api/users/bug-report {note, log, meta}` | файл `bugreport_<ник>_<время>.txt` в `uploads/files/` → файловое сообщение от имени репортёра в ЛС каждому получателю (`BUG_REPORT_TO`: ники/id через запятую, сравнение `_norm` без регистра/пробелов/_/-; только одобренные **админы**; пусто или никто не найден → все админы). Лог режется до 1,5 МБ, note до 500, одинокие суррогаты UTF-16 → «?». Пуш получателю без троттлинга |

**chats** (`api/chats.py`, `notes.py`, `api/polls.py`):

| Метод и путь | Что |
|---|---|
| `GET /api/chats` | список чатов юзера с последним сообщением и unread; Заметки тоже здесь |
| `POST /api/chats/dm?target_user_id=` | найти или создать ЛС (`get_or_create_dm`: по составу; второй стороне `new_chat`) |
| `POST /api/chats/group {name, member_ids, allow_all_write}` | группа ≤7 с создателем |
| `GET /api/chats/{id}/stats` | `media_count`, `link_count`, `file_count` |
| `PATCH /api/chats/{id}` | создатель: `name`, `description`, `admin_ids`, `compendium_enabled` → WS `chat_updated` **без** `last_message` |
| `POST /api/chats/{id}/avatar` | аватар группы → `uploads/group_avatars/` |
| `POST /api/chats/{id}/members {user_id}` | добавить (создатель/админ, ≤7) |
| `DELETE /api/chats/{id}/members/{uid}` | кик |
| `POST /api/chats/{id}/leave`, `DELETE /api/chats/{id}` | выйти; удалить (создатель) → `chat_deleted` |
| `DELETE /api/chats/admin/messages/old?before_days=` | админ: чистка сообщений старше N дней (единственное удаление «по дате») |
| `GET /api/chats/{id}/messages?limit=50&before_id=` | история, по возрастанию id |
| `POST /api/chats/{id}/files?caption=&media_group_id=` | файл потоком кусками по 1 МБ в `uploads/files/`; лимит: видео (`VIDEO_EXTS` mp4/mov/m4v/webm/mkv/3gp или `video/*`) до `MAX_FILE_SIZE_MB`, остальное 10 МБ; перебор → 400 и файл удаляется; caption с `/quest_card`/`/poll` режется; WS `message` всем + пуш с превью (🎤/🖼/🎬/📎) с троттлингом |
| `GET /api/chats/{id}/search?q=` | поиск по тексту сообщений чата |
| `GET /api/chats/{id}/read-status` | `[{user_id, last_read_message_id}]` |
| `GET /api/chats/unread/counts` | `{chat_id: n}` |
| `GET /api/chats/online/users` | `{online_user_ids}` |
| `GET /api/chats/notes` | найти или создать Заметки |
| `POST/GET /api/notes/reminders`, `DELETE /api/notes/reminders/{id}` | напоминания: создание пишет карточку `/reminder {json}` в Заметки |
| `POST /api/chats/{id}/polls` | опрос: 2..12 вариантов, дедуп; носитель `/poll {id}` создаётся сервером в той же транзакции; в канале — только создатель |
| `GET /api/polls/{id}`, `POST .../vote {option_id}` (тоггл; одиночный выбор переезжает), `POST .../options {text}` (дописать свой, если `allow_add`), `POST .../close` (автор или админ чата; в ЛС — только автор) | всё под `with_for_update(Poll)`; WS `poll_updated` с полным `PollOut`, `mine` клиенты считают сами из `voter_ids` |
| `GET /api/chats/{id}/pins`, `POST /api/chats/{id}/pin {message_id}`, `DELETE /api/chats/{id}/pin/{mid}` | закрепы до 20; права в группе — создатель и `admin_ids`, в ЛС — оба; WS `chat_pins` со всем списком |

**dota** (`api/dota.py`): `POST /api/dota/call` — сообщение `/dota_call` в
чат + пуш всем без троттлинга (`tag dota-{chat}`).

**poker** (`api/poker.py`) — все мутирующие ручки читают стол через
`_locked_table()` = `SELECT … FOR UPDATE`, замок до commit:

| Метод и путь | Что |
|---|---|
| `GET /api/poker/active` | `{chat_id: "lobby" или "playing"}` по чатам юзера (значок стола в сайдбаре) |
| `GET /api/poker?chat_id=` | столы чата |
| `POST /api/poker {chat_id, …настройки}` | создать стол (`_apply_settings`: стек ≥ 5 BB, BB = 2×SB, места 2..6 и т.д.) |
| `PATCH /api/poker/{id}/settings` | создатель, только lobby; режим/цену нельзя менять при любых сидящих |
| `POST /api/poker/{id}/join` | сесть; в режиме gas — атомарное списание `entry_gas` из профиля текущего сезона (`bets.try_debit`), не хватило → 400 |
| `POST /api/poker/{id}/leave` | из лобби — возврат газа; из игры — `poker_game.leave_game` (фолд, стек 0, место свободно) |
| `POST /api/poker/{id}/start` | создатель, ≥2 сидящих → `GameStore`, статус playing |
| `POST /api/poker/{id}/close` | создатель; до финала возвращает `gas_paid` всем |
| `POST /api/poker/{id}/reentry` | докупка: `can_reenter` (вылетел, `blind_level < reentry_until_level`, лимит) → списание → `reenter`; гонка с финалом → 409 + возврат |
| `POST /api/poker/{id}/restart` | «Сыграть ещё»: новый стол с теми же настройками и людьми, старый удаляется (`poker_table_removed` летит раньше ответа) |
| `GET /api/poker/{id}/history` | история раздач из памяти (свежие сверху) + `names` |

**compendium** (`api/compendium.py`) — см. §7.8: `GET /me`, `PATCH
/cosmetics`, `GET /seasons`, `GET/POST /bets`, `GET /season`, `GET
/user/{id}`, `GET /prize`, `GET/POST /prizes`, `PATCH/DELETE
/prizes/{id}`, `POST /prize/draw`. Порядок роутов важен: `/seasons` и
`/season` объявлены до `/user/{id}`.

**Прочее**: `GET /apk/info` (имя релиза/дата/размер/`version`/`build` из
meta.json зеркала, 404 пока зеркала нет), `GET|HEAD /apk` (файл APK с
правильным mime; 302 на GitHub, пока кэша нет), `GET|HEAD
/uploads/{path}` — своя раздача файлов (`uploads_static.py`): 206 +
`Content-Range` на одиночный диапазон (включая суффикс `bytes=-N`), 416,
`Accept-Ranges` всегда, защита от `..`. Нужна потому, что starlette 0.37
на Range отвечает 200 целиком, а Chromium тогда не даёт перематывать
`<audio>` и качает m4a целиком ради moov в хвосте. **Каталог uploads
публичен целиком** — см. §6.11.

### 6.7 WebSocket (`ws/manager.py`, `ws/handler.py`)

Подключение: `GET /ws?token=<jwt>`. Плохой токен → close 4001. На первом
сокете юзера всем летит `user_online`; новому сокету — снимок
`dota_presence` и `call_active` по каждому идущему звонку в его чатах.
Сервер держит uvicorn-пинги (20 с + таймаут 20 с) — зомби-сокет клиента
выкидывается примерно через 40 с, клиентам нужен свой сторож (§8, §9).

`ConnectionManager`: `active: user_id → [WebSocket]` (мультисокеты —
десктоп + телефон одновременно), `chat_users: chat_id → set(user_id)`,
`active_calls: chat_id → set(user_id)`, `call_sockets: chat_id → user_id →
set(WebSocket)` (состав по юзеру, но выход из звонка — делом
**устройства**), `call_meta: chat_id → {initiator, started, answered,
…}` (для `/call_record` и таймера «не взяли»). Методы:
`connect/disconnect`, `join_chat`, `join_call/leave_call/end_call/
drop_call_socket`, `broadcast_to_chat(chat_id, msg, exclude_user)`
(дедуп по `_eid`; `exclude_user` вырезает **все** сокеты юзера),
`send_to_user`, `is_online`, `get_online_user_ids`; мёртвые сокеты
дропаются при ошибке отправки. Дисконнект любого сокета выводит юзера из
звонков этого сокета и рассылает `call_end` + `call_active` (раньше
чистка жила под «юзер полностью оффлайн», и умерший телефон висел в
составе — на компе вечное «вы в звонке с другого устройства»).

**Входящие события** (`{"type": ..., ...}`; `handler.py`, цепочка
`if event == ...`):

| type | Поля | Поведение |
|---|---|---|
| `ping` | | → `pong` (клиенты меряют задержку) |
| `message` | `chat_id, content, reply_to_id?, _temp_id?` | проверка членства и режима канала; маркеры `/quest_card` и `/poll` в тексте режутся (анти-спуф); счётчик `grammar_errors` по регэкспам; INSERT; WS `message` всем в чате (с `_temp_id` отправителю для замены оптимистичного сообщения); пуш оффлайн-участникам с троттлингом 15 с/чат |
| `typing` | `chat_id` | бродкаст `typing {chat_id, user_id, username}` остальным |
| `dota_ready` / `dota_ready_request` | `chat_id, message_id, ready` | эфемерный ready-лист карточки `/dota_call` (TTL 3 ч, в памяти) → `dota_ready_update` |
| `forward_message` | `target_chat_id, content, original_author, file_url?, file_name?` | новое сообщение `[Переслано от X]` в целевой чат |
| `reaction` / `remove_reaction` | `message_id, emoji` | → `reaction` / `reaction_removed` всему чату |
| `dota_client_presence` | | десктоп увидел `dota2.exe`; отметка с TTL 180 с (§6.9) |
| `mark_read` | `chat_id, message_id` | upsert `read_receipts`; `message_read {chat_id, user_id, message_id}` **всем** сокетам чата, включая другие устройства читателя (кросс-девайс прочитанность и гашение уведомлений); затем `push.send_read_sync` (тихий Web Push, §11) |
| `video_status` / `screen_share_status` / `mute_status` | `chat_id` + `enabled` / `sharing` / `muted` | ретрансляция участникам звонка |
| `edit_message` | `message_id, content` | только автор; тоже режет серверные маркеры → `message_edited` |
| `delete_message` | `message_id` | только автор → `message_deleted`; `read_receipts`, указывавшие на удалённое, переставляются на новое последнее; если был закреплён — `chat_pins` |
| `poker_action` | `table_id, action, amount?` | ход в раздаче (`poker_game`), затем `broadcast_and_continue` |
| `poker_request_state` | `table_id` | адресный `poker_game_state` |
| `call_signal` | `chat_id, target_user_id, signal, purpose?, role?` | WebRTC-сигналинг (оффер/ансвер/кандидат) — пересылка адресату `send_to_user`; первый сигнал юзера в звонке регистрирует его в составе; первый сигнал вообще создаёт `call_meta`, шлёт пуш «Входящий звонок» и ставит таймер `_missed_call_timeout` 60 с (привязан к записи звонка по identity, а не к chat_id — иначе таймер первого звонка закрывал следующий); другим сокетам сигналящего — `call_taken {chat_id}`; `call_active` при смене состава; лог `[ws][call_signal] forward … (sockets=N)` — `sockets=0` значит у адресата нет живого сокета |
| `call_join` | `chat_id` | вход в идущий звонок: регистрация в составе (повтор игнорируется), `call_active` всем; join в мёртвый звонок → адресный пустой `call_active` |
| `call_end` | `chat_id, declined?` | выход устройства из звонка; `call_end` остальным участникам (без сокетов отправителя) + адресно своим другим устройствам; `call_active`; когда звонок кончился — запись `/call_record kind\|dur\|n\|initiator` (kind: completed/missed/declined/cancelled) |

**Исходящие события**: `pong`; `message` (варианты с `_temp_id`,
`reactions`, `media_group_id`, `reminder_fired`), `message_edited`,
`message_deleted`, `message_read`, `reaction`, `reaction_removed`,
`typing`; `user_online`, `user_offline`; `new_chat`, `chat_updated`,
`chat_deleted`, `chat_pins`, `poll_updated`; `profile_updated` (единый
пейлоад `_broadcast_profile` из users.py: ник/аватар/статус/dota/comp_*/
`comp_extra`), `new_pending_user`; `dota_presence {playing}`,
`dota_ready_update`; `video_status`, `screen_share_status`,
`mute_status`; `call_signal`, `call_active {chat_id, user_ids}`,
`call_taken`, `call_end {chat_id, user_id, timeout?, declined?}`;
`poker_table_created/updated/removed`, `poker_game_state`, `poker_error`.
Клиентская синтетика `_ws_open` (не от сервера) — момент (ре)коннекта.

### 6.8 Покер (`poker_engine.py`, `poker_game.py`, `api/poker.py`)

- `poker_engine.py`: колода, оценка комбинации 7 → лучшие 5.
- `poker_game.py`: sit-and-go турнир. `GameStore` — **in-memory**
  (`game_store.get(table_id)`), рестарт сервера убивает раздачу.
  `GameState`: игроки (`stack`, `bet`, `folded`, `all_in`, `left`),
  улицы preflop → flop → turn → river → showdown → done, блайнды растут
  по времени ×1,5 с округлением к шагу по порядку текущего SB
  (`blind_step`: 10→5, 100→50, 1000→500; 100/200 → 150/300 → 250/500 →
  400/800…), BB всегда 2×SB; сайд-поты по уровням вложений, нечётная
  фишка — младшему `seat_index`; таймеры: 5 с шоудаун, 3 с невостребованный
  банк, фаст-форвард 0,7+0,85 с, пауза докупки `REENTRY_GRACE_SECONDS=30`;
  часов на ход нет. `hand_log` → `history` (кэп 200): стеки на входе,
  блайнды, действия с `to`, улицы, вскрытые карты.
- «Встать» посреди турнира (`leave_game`): фолд в живой раздаче (свой ход
  → `_advance`, чужой — только пометка), стек 0, `left`, энтри «за газ»
  остаётся в котле. Ремни: `finalized_hand_no` (раздача доводится один
  раз), `fast_forwarding` (один `_ff` на раздачу).
- Финал (`_finish_tournament`): под FOR UPDATE; выходит без выплаты, если
  стола уже нет или `game_store.get(id) is not g`; котёл «за газ» →
  `bets._credit` победителю в текущий сезон + текст в чат + `profile_updated`;
  `poker_table_updated` со `status=finished`. Пауза докупки: фишки
  остались у одного, но есть кандидаты на докупку → турнир не закрывается
  до дедлайна (`_grace_watch`); докупка через API зовёт
  `resume_after_reentry`.
- `close_stale_tables` (30 мин): лобби по `created_at`, играющие — от
  `started_at`, старше 6 ч → снос с `poker_table_removed`; «за газ» и не
  доиграно — возврат `gas_paid`.
- Рубашки карт: `PokerSeatOut.card_back` из `comp_extra` хозяина места
  (сервер хранит только имя; рисуют клиенты).

### 6.9 Прочие модули

- **`push.py`, `webpush.py`** — см. §11.
- **`notes.py`** — Заметки (`Chat.is_notes`, один участник, лениво) +
  напоминания: карточка `/reminder {json}` в Заметках (клиенты рендерят её
  **только** в is_notes-чате — анти-спуф), джоба раз в 30 с: срок → «⏰
  текст» в Заметки + пометка `fired` + Web Push (`tag reminder-{id}`).
  Expo-пуш не шлём: нативный Android планирует локальное уведомление сам.
- **`steam_presence.py`** — «🎮 в Доте сейчас»: раз в 2 мин
  `GetPlayerSummaries` батчами по 100 (IPv4-клиент), in-memory набор, WS
  `dota_presence {playing}` при смене состава + снимок новому сокету.
  Невидимка `users.dota_presence_visible`; ошибка Steam — состав не
  трогаем. Второй источник — десктоп детектит `dota2.exe` и шлёт
  `dota_client_presence` с хартбитом 60 с (TTL 180 с, `_client_until`),
  работает при стим-невидимке. Без `STEAM_API_KEY` Steam-часть спит.
- **`opendota.py`** — httpx-клиент **строго IPv4** (`local_address=
  "0.0.0.0"`: IPv6 на VPS виснет до таймаута), connect 5 / read 25 с,
  2 ретрая; `resolve_link_input`. Лимит free: 2000/день, 60/мин.
- **`apk_mirror.py`** — зеркало APK: качает `gandolachat.apk` из релиза
  `mobile-latest` в `uploads/apk/` (сравнение по `updated_at` в
  `meta.json`, `.part` + atomic rename, докачка через Range, 12 попыток,
  выход сразу по счётчику байт — GitHub-CDN в РФ душат). `_parse_release_name`
  разбирает «GandolaChat Android 0.9.2 (сборка 11)» — формат имени релиза
  в Actions менять нельзя.
- **`backups.py`** — `pg_dump -Fc` (бинарник скопирован из образа
  `postgres:16-bookworm` в multi-stage Dockerfile с ldd-сбором библиотек;
  `RUN pg_dump --version` в сборке — страховка от несовместимого glibc),
  ротация 14, офсайт PUT на WebDAV + удалённая ротация через PROPFIND;
  вложения — инкрементально по каталогам `files`, `avatars`,
  `group_avatars`, `vapid` (apk и compendium пропускаются), сверка по
  имени и размеру, удалённое не удаляем, состояние в
  `backups/uploads-sync.json`. Восстановление: `pg_restore --clean
  --if-exists -h db -U gandola -d gandolachat` (затирает базу).
- **`disk.py`** — лог места при старте.
- **`schemas.py`** — Pydantic-модели ответов (`UserOut`, `MeOut`,
  `ChatOut`, `MessageOut`, `PokerTableOut`/`PokerSeatOut`, …).

### 6.10 Служебные маркеры сообщений

Клиенты распознают по началу `content`:

| Маркер | Кто создаёт | Клиентский виджет |
|---|---|---|
| `/dota_call` | `POST /api/dota/call` | карточка «газуем в дотан» с ready-листом (десктоп; мобилка показывает текстом) |
| `/poker_table N` | создание стола | приглашение за стол |
| `/poll N` | `POST .../polls` | опрос (клиент сверяет `poll.chat_id`) |
| `/quest_card {json}` | поллер/финал/ставки/итоги недели | карточка Гандолиума (`kind`: quest/anti/team/bet_result/week_recap/season_final; `special`: rampage/fullstack) |
| `/reminder {json}` | `POST /api/notes/reminders` | карточка напоминания (только в Заметках) |
| `/call_record kind\|dur\|n\|initiator` | конец звонка | «Звонок: 12:34, 3 участника» |
| `⏰ текст` | джоба напоминаний | обычный текст |
| `[Переслано от X]` | `forward_message` | цитата пересылки |
| `🐞 Баг-репорт`, `🎰 ВА-БАНК…`, `🏆 Покер, стол #…`, `🃏 Ещё партия` | сервер | обычный текст |

Щиты от подделки `/quest_card` и `/poll` стоят в трёх местах: новое
сообщение, `edit_message`, caption файла. Новый путь создания сообщений
или новый серверный маркер — добавлять туда же (ловушка №6).

### 6.11 Известные дыры безопасности (не исправлены на момент правки)

Проект на доверенную компанию, но знать надо:

- `uploads/` раздаётся целиком, включая **`uploads/vapid/private.pem`** —
  приватный VAPID-ключ Web Push доступен по `GET
  /uploads/vapid/private.pem`; он же уходит в офсайт-бэкап вложений.
  Лечение: исключить `vapid/` в `uploads_static.py` (и лучше перенести
  ключи из uploads).
- Часть WS-событий не проверяет членство в чате: `typing`, `reaction`,
  `remove_reaction`, `mark_read`, `video_status`, `screen_share_status`,
  `mute_status`, `call_end`, сторона отправителя `call_signal`.
- `GET /api/chats/{id}/read-status` без проверки членства.
- Неодобренные пользователи видны в `GET /api/users/search` и с ними
  можно создать ЛС.
- TURN-учётка статическая и зашита в оба клиента (`gandola/gandolapass`);
  coturn без TLS. Для компании друзей приемлемо, но релей может
  использовать любой, кто прочитает исходники.

<!-- SECTION:7-compendium -->
## 7. Гандолиум (компендиум Dota 2)

Код: `server/app/compendium/` (`quests.py`, `engine.py`, `poller.py`,
`bets.py`, `weekly.py`, `finale.py`, `prizes.py`, `halloween.py`),
API — `server/app/api/compendium.py`, клиент OpenDota —
`server/app/opendota.py`. Клиентские экраны: десктоп
`CompendiumPage.tsx`, мобилка `screens/compendium/*`.

### 7.1 Базовые понятия

- **Время**: всё по МСК = UTC+3 фиксированно, без перехода (`engine.MSK`,
  `to_msk`). Наивные datetime считаются UTC.
- **Сезон** = `"YYYY-MM"` по МСК (`engine.season_of`, `current_season`).
  Строки сезонов сравниваются лексикографически — это совпадает с
  хронологией.
- **Ключ дня** = `"YYYY-MM-DD"` МСК. **Ключ недели** = `"YYYY-MM-Www"`:
  месяц сезона плюс номер ISO-недели (`week_key_of`). Неделя на стыке
  месяцев в новом сезоне начинается заново — иначе сентябрьские недельные
  висели «выполненными» в октябре. Старые строки с ключом `"YYYY-Www"`
  новым не мешают.
- **Какие матчи считаются** (`poller.poll_matches`): источник — OpenDota
  `/players/{id}/recentMatches` (~20 последних), по одному вызову на
  привязанного пользователя за цикл; только `lobby_type == 7` (ranked);
  `start_time >= users.dota_linked_at`; не больше
  `MAX_NEW_MATCHES_PER_CYCLE = 5` новых матчей на пользователя за цикл,
  старые вперёд; матч не должен быть уже сохранён (уникальный индекс
  `(match_id, user_id)` в `dota_matches`); `account_id` пользователя
  обязан встретиться в `/matches/{id}.players`.
- **Привязка Steam** (`POST /api/users/me/steam`): `dota_linked_at`
  ставится при новой привязке (или если была пуста); привязка **другого**
  аккаунта удаляет все `DotaMatch` пользователя (история не смешивается),
  выполнения и газ остаются; при привязке сеется
  `CompendiumProfile.start_rank_tier`. Отвязка чистит `dota_*` и
  `linked_at`.
- **Газ → уровень** (`engine`): до сезона `NEW_CURVE_FROM = "2026-10"`
  старая линейка `level = gas // 100 + 1` без потолка (так люди её
  видели в сентябре, снапшоты не переписываются); с октября-2026 кривая
  `gas_for_level(n) = 5·(n−1)·(n+10)`, каждый следующий уровень на
  `10n+50` дороже, потолок `LEVEL_CAP = 30`. Пороги: 2-й уровень за 60,
  12-й 1210, 20-й 2850, 25-й 4200, 30-й 5800. `level_progress` на потолке
  отдаёт `(1, 1)`, клиенты пишут «МАКС». **`level_for_gas` всегда зовут с
  сезоном** — без него считается новая кривая, что для старого сезона
  было бы «понижением задним числом».
- **`level_for_cosmetics(gas, season)`** — единственное место зачёта в
  `users.comp_max_level` (уровень лучшего сезона, по которому
  открывается косметика): старые сезоны считаются не выше
  `OLD_SCALE_MAX_LEVEL = 12` (там косметика кончалась на 12-м; «сороковые»
  сентября не должны получить новое даром). Поллер только поднимает
  `comp_max_level`; `bets.recalc_max_level` пересчитывает и может
  опустить (см. ставки).
- **Выполнения** хранятся в `quest_completions`: `user_id, season,
  quest_id, period_key, gas` (со знаком), `match_id` (nullable),
  `completed_at`; уникальность `(user_id, quest_id, period_key)`.
  `period_key` по правилу `engine._period_key`:

| `repeat` / источник | period_key |
|---|---|
| `match` | `str(match_id)` (можно повторять каждый матч) |
| `day` | дата МСК (не чаще раза в день) |
| `week` | ключ недели (не чаще раза в неделю) |
| `period` (дефолт) у daily | дата матча |
| `period` у weekly | ключ недели матча |
| `period` у season/anti/secret | сезон матча |
| командные (`evaluate_team`) | сезон |
| s38 «Восхождение» (из `refresh_ranks`) | текущий сезон, `match_id = NULL` |
| a49 «Дно недели» (`weekly_roast`) | ключ прошлой недели |
| a58 «Якорь сезона» (`weekly_roast`) | сезон |

- **Кошелёк сезона**: `compendium_profiles(user_id, season, gas,
  start_rank_tier, updated_at)`, уникальность `(user_id, season)`.
  Ставки и покер «за газ» списывают/зачисляют атомарными SQL-операциями
  (см. 7.5).

### 7.2 Каталог заданий (`quests.py`)

Класс `Quest`: `id, num, category, name, desc, gas, needs_parse,
check(m, ctx) -> bool, progress(ctx) -> (current, target),
team_check(tc) -> bool, repeat = "period", special, title`.
`needs_parse` — только UI-пометка 📼 («ждёт разбора реплея»), движок по
нему ничего не гейтит: парс-поля у неразобранного матча просто нули.

Пулы: daily 27, weekly 22, season 15, team 8, anti 16, secret 20 — всего
108. Ротация: `daily_rotation(day_key)` =
`sorted(random.Random(f"gandolium:daily:{day_key}").sample(DAILY_POOL, 5))`,
`weekly_rotation(week_key)` аналогично с 7 активными. Строковый сид
детерминирован, рестарт сервера ротацию не меняет; движок берёт
день/неделю **матча**, `/me` — сегодняшние. Сезонные, анти, тайные и
командные активны всегда.

Хелперы детекции: `kda = (K+A)/max(D,1)`; саппорт = `is_parsed и
wards_placed >= 5`; кор = `last_hits >= 120`; `_night` = час МСК 0–5;
`_halloween_night` = 31 октября после 18:00 МСК; `is_undead` = герой из
`UNDEAD_HEROES` (21 герой: Pudge 14, Lich 31, Necrophos 36, Undying 85,
Wraith King 42, Lifestealer 54, Death Prophet 43, Night Stalker 60,
Abaddon 102, Visage 92, Spectre 67, Shadow Fiend 11, Doom 69, Bane 3,
Grimstroke 121, Dark Willow 119, Muerta 138, Vengeful Spirit 20,
Terrorblade 109, Pugna 45, Witch Doctor 30); `HERO_SNIPER = 35`,
`HERO_WINTER_WYVERN = 112`, `ITEM_RAPIER = 133`; `_items(m)` и
`_extra(m, key)` читают JSON `dota_matches.data`.

**Ежедневки (27, ключ = дата)** — id / название / газ / условие:
d01 Победная 15 (победа); d02 Двойная доза 25 (2 победы за день);
d03 Бессмертный 20 (победа, ≤1 смерть); d04 Фармила 15 (GPM ≥ 600);
d05 Мудрец 15 (XPM ≥ 700); d06 Крипоед 20 (300+ ластхитов); d07 Жадина
15 (20+ денаев); d08 Терминатор 15 (10+ убийств); d09 Дирижёр 15 (20+
ассистов); d10 KDA-машина 20 (KDA ≥ 10); d11 Разрушитель 15 (8000+ урона
по строениям); d12 Медбрат 15 (5000+ лечения); d13 Глаза команды 15 📼
(10+ вардов); d14 Лесник 20 📼 (6+ стаков); d15 Бегущий по рунам 10 📼
(6+ рун); d16 Скромный герой 20 (победа, ≤3 убийств, 15+ ассистов);
d71 Нежить 20 (победа на нежити); d72 Чёртова дюжина 20 (ровно 13
убийств); d73 Полуночник 20 (победа в 0–2 МСК); d74 Я тебе вакцину
поставлю 20 📼 (первая кровь + победа); d75 Кровавая луна 20 📼 (серия
5+ убийств); d76 Гробовщик 25 (15+ убийств); d77 Живучий 15 (поражение
40+ мин, ≤3 смерти); d78 Ведьмин котёл 15 (победа, 5+ убийств, 10+
ассистов); d79 Разоритель 20 (12 000+ по строениям); d80 Тьма сгущается
20 (победа 50+ мин); d81 Кальянщик 20 📼 (3+ дыма за катку, титул
«Кальянщик»).

**Недельные (22, ключ = неделя сезона):** w17 «МАРК епта, что ты делаешь»
60 (три победы подряд; переименован хозяином, бывший «Хет-трик»); w18
Работяга 50 (7 каток за неделю); w19 Пятидневка 60 (5 разных дней);
w20 Гроссмейстер пула 70 (победы на 5 героях); w21 Мясник 60 📼
(трипл-килл+); w22 Доминатор 70 📼 (серия 8+, титул); w23 Спидраннер 50
(победа ≤25 мин); w24 Осада века 60 (победа 60+ мин); w25 Тонна урона 50
(40 000+ по героям); w26 Первая кровь 40 📼; w27 Стабильность 50 (3 игры
подряд с K+A > D); w28 Два лица 70 📼 (за неделю победа на коре и на
саппорте); w29 Рошан наш 50 📼 (2+ рошана команды и победа); w30 Уровень
эго 40 (25 уровень героя и победа); w83 СуперГимнаст 80 (победа без
смертей 40+ мин); w84 «Аня лечи меня, АНЯ!» 70 (10 000+ хила); w85
Некромант 70 (3 победы на нежити за неделю, титул); w86 Экзорцист 60
(победа против 2+ нежити у врага); w87 Голова с плеч 60 (10+ убийств на
нежити); w88 Восставший 60 (победа после 3+ поражений подряд); w89
Кладбищенский сторож 50 📼 (15+ вардов); w90 Жатва 60 (40+ убийств за
день).

**Сезонные (15, ключ = сезон):** 12 марафонов с `progress` и три
особых. s31 Марафонец 200 (30 каток); s32 Двадцаточка 250 (20 побед);
s33 Коллекционер 200 (победы на 12 героях); s34 Универсал 300 📼 (победа
на миде `lane_role == 2`, на коре `lane_role ∈ {1,3}` с 120+ ластхитами
и на саппорте); s35 Комбайн 150 (5000 ластхитов суммарно); s36 Жнец 200
(300 убийств); s37 Смотрящий 200 📼 (200 вардов); s38 Восхождение 400
(титул «Восходящий»; без предиката — выдаёт `refresh_ranks`, когда
медаль `rank_tier // 10` выросла относительно `start_rank_tier`); s39
Стахановец 150 (20 ежедневок за сезон); s40 Отбились от мег 300 (разовое
с `check`: победа при 6 потерянных своих бараках); s91 Ваня Виверна 200
(10 каток на Winter Wyvern, титул «Виверна»); s92 Тыквенный марафон 250
(13 побед на нежити); s93 Ночной дозор 150 (10 ночных каток); s94 Легион
200 (15 каток с людьми из чата); **d82 Яшка в Тельняшке 100 📼** (разовое
с `check`: победа на Снайпере на саппорте с K+A > D; категория `season`,
id оставлен `d82` ради старых трофеев — категория это поле, по префиксу
id ничего не считается).

**Командные (8, `team_check(tc)`, ключ = сезон):** t41 Дуо-катка 40
(вдвоём и победа); t42 Трио 60; t43 ФУЛЛ СТАК 150 (впятером и победа;
`special = fullstack`, титул «Фулл-стак», пуш всем без троттлинга); t44
Дружба крепче ММР 100 (5 совместных побед за сезон); t45 Спина к спине
80 (победа после того, как прошлая катка тем же составом была выиграна);
t46 Караван 90 (втроём, победа ≤30 мин); t47 Реванш-машина 120 (победа
после проигранной прошлой катки тем же составом); t48 Ночная смена 50
(победа ночью).

**Анти (16, выдаются сами — «прожарка»):** a49 Дно недели 30 (без
предиката: `weekly_roast`, худший винрейт недели при ≥5 играх, титул
«💀 Дно недели»); a50 Курьер бронзы 10/день (≤1 убийство, 10+ смертей,
титул «Курьер»); a51 Донор крови 15/день (15+ смертей); a52 Спонсор
вражеского кэрри 20/матч (ровно 3 поражения подряд); a53 Слепой саппорт
10/день 📼 (25+ мин, 0 вардов, `lane_role == 4` или мало ластхитов и
GPM; титул «Гринч»); a54 Фармил, пока базу сносили 15/день (GPM 700+ и
поражение); a55 Пацифист поневоле 10/день (40+ мин, <8000 урона); a56
Проклятый 40/матч (5 поражений подряд, титул); a57 Так близко 15/день
(поражение 55+ мин); a58 Якорь сезона 50 (второе «Дно недели» за сезон,
титул); **a95 «Чел, ну это жесть» −25** (≤1 убийство и 15+ смертей,
титул «Жесть»; текст хозяина «я даже прибавить газа не могу тебе»);
**a96 Ливер −20** (abandon: `data.leaver >= 2`, титул); a97 Зомби 15
(30+ мин, 0 убийств и 0 ассистов); a98 Призрак 10 (30+ мин, GPM < 250);
a99 Пугало 10 (40+ мин, 0 урона по строениям); a100 Тильт-машина 25 (4+
катки за день и ни одной победы, титул «Тильт»). Штрафные анти уводят
газ вниз, поллер режет профиль не ниже 0; клиенты рисуют знак сами.
Анти-ачивки **вечные** — хозяин отклонил «страховку от дна».

**Тайные (20, в UI скрыты до выполнения, в «Бинго» — за всё время):**
x59 РАМПАГА 200/матч 📼 (пентакилл; `special = rampage` — особая
карточка + пуш «🚨 РАМПАГА!»); x60 Ультра 100/матч 📼 (ровно
ультракилл); x61 Рыцарь рапиры 50/матч (поражение с рапирой); x62 Рапира
победы 100/матч; x63 Безупречный 150/матч (победа, 10+ убийств, 0
смертей, титул); x64 Юбилейная 100 (сотая катка за всё время); x65 Сова
50/нед (победа в 3–6 МСК); x66 Однолюб 80/нед (3 победы подряд на одном
герое); x67 С возвращением 30/матч (перерыв 7+ дней); x68 Царь горы
100/матч 📼 (2+ аегиса); x69 Олигарх 60/нед (нетворс 40 000+); x70
Смурф? 100/нед (KDA ≥ 20); x101 Виверна, я тебя знаю 150 (25-я катка на
Winter Wyvern за сезон); x102 Хеллоуин 66/нед (победа в ночь 31.10 после
18:00); x103 Число зверя 66/матч (6/6/6); x104 Восставший из фида 50/нед
(победа при 12+ смертях, титул); x105 Ночной кошмар 100/нед (3 ночные
победы за день); x106 Тыквенный король 150/нед (5 побед подряд на
нежити, титул); x107 Кровавый след 100/матч (25+ убийств); x108 Дым и
зеркала 60/нед 📼 (5+ дымов).

Титулы (носятся в косметике с уровня 4; «Чемпион <месяца>» — с любого):
Доминатор, Восходящий, Фулл-стак, 💀 Дно недели, Курьер, Гринч,
Проклятый, Якорь сезона, Рампага, Безупречный, Кальянщик, Некромант,
Виверна, Жесть, Ливер, Тильт, Восставший из фида, Тыквенный король.

### 7.3 Движок (`engine.py`)

- **`UserCtx`** (собирает `poller._build_ctx`): `season`; `all_rows` —
  строки `DotaMatch` пользователя за последние 60 дней (`ROWS_WINDOW_DAYS`)
  по времени; `rows` — из них за сезон; `completion_keys` — множество
  `(quest_id, period_key)` за все сезоны, мутируется в ходе оценки;
  `total_matches_all_time`; `prev_before_window` (дата последнего матча
  до окна — для «С возвращением»); `_daily_done`. Методы: `day_rows(m)`,
  `week_rows(m)` (та же дата / та же неделя сезона), `_rows_up_to(m)`,
  стрики через `_streak(m, pred)` назад от `m` (сквозь границы сезонов):
  `win_streak_ending_at`, `lose_streak_ending_at`,
  `positive_kda_streak_ending_at` (K+A > D),
  `same_hero_win_streak_ending_at`, `undead_win_streak_ending_at`;
  `lose_streak_before(m)`; `season_rows_up_to(m)`; `gap_before_days(m)`;
  `daily_completions_count()`.
- **`TeamCtx`**: `m` (строка участника), `size`, `lineup_key`
  (`"3-7-12"` — отсортированные user_id), `ctx`; `joint_wins_season()`,
  `lineup_prev_result()` — результат прошлой катки тем же составом или
  `None`.
- **`evaluate_match(m, ctx)`**: активный набор = ротация дня матча (5) +
  ротация недели матча (7) + все season/anti/secret с `check`; для
  каждого: ключ периода, пропуск уже выполненных, `check` (исключение =
  False), новое выполнение добавляется в `completion_keys`; затем
  `_daily_done` пополняется новыми ежедневками (чтобы «Стахановец» видел
  их сразу); затем марафоны с `progress`: если `(id, season)` не выполнен
  и `cur >= target` — выполнение с ключом сезона. Возвращает только
  **новые** выполнения.
- **`evaluate_team(tc)`**: все `team_check`, ключ = сезон.
- **`extract_player_facts(match, player)`** — разбор `/matches/{id}` в
  столбцы `DotaMatch`: `started_at` (UTC), `duration`, `hero_id`,
  `is_radiant` (`player_slot < 128`), `is_win`, K/D/A, `gpm/xpm`,
  `last_hits/denies`, `hero_damage/tower_damage/hero_healing`,
  `hero_level`, `net_worth` (или `total_gold`), `wards_placed` (obs +
  sen), `camps_stacked`, `runes_picked` (сумма по рунам),
  `multi_kill_max`, `kill_streak_max`, `firstblood`, `lane_role`,
  `is_parsed` (`match.version is not None`). JSON `data`: `items` (6 слотов
  + 3 рюкзака), `own_rax_lost` (по маске бараков своей стороны),
  `team_roshans` (objectives `CHAT_MESSAGE_ROSHAN_KILL` своей стороны),
  `aegis_picks` (по слоту), `party_id/party_size`, `smokes` (из
  `purchase_log`), `leaver` (`leaver_status`), `ally_heroes/enemy_heroes`
  по стороне. `team_key/team_size` пишет `_handle_team`, `season` —
  поллер.

### 7.4 Поллер и джобы (`poller.py`)

Все джобы компендиума (включая `week_recap` и `finalize_season`) — под
общим `asyncio.Lock` `_JOB_LOCK` (иначе гонки за газ и дубли). API
(ставки, покер) замок не берут — теоретическое окно lost update на
`gas`; на практике операции атомарны на уровне SQL (см. 7.5).
Константы: `MAX_NEW_MATCHES_PER_CYCLE = 5`, `PARSE_MAX_ATTEMPTS = 8`,
`PARSE_WINDOW_HOURS = 36`, `ROWS_WINDOW_DAYS = 60`.

| Джоба | Расписание (`main.py`) | Что делает |
|---|---|---|
| `poll_matches` | каждые `max(5, DOTA_POLL_MINUTES=20)` мин, один экземпляр | снапшот привязанных → `recentMatches` → фильтр → до 5 новых матчей на человека → `_process_new_match`; в конце `bets.sweep_expired` |
| `recheck_parses` | каждые 20 мин | строки `is_parsed=False`, `parse_attempts < 8`, моложе 36 ч: `get_match`, при парсе — перезапись фактов, переоценка заданий, `bets.settle_after_parse`; командные повторно не считаются |
| `refresh_ranks` | каждый час | `get_player` → `rank_tier/leaderboard_rank` (пустой `rank_tier` старый не затирает), сев `start_rank_tier`, s38 при росте медали |
| `weekly_roast` | cron 00:25 UTC ежедневно (03:25 МСК), гард «только понедельник МСК», misfire 20 ч | «Дно недели»: окно прошлая Пн–Пн, ≥5 игр, худший винрейт (тай-брейк — больше поражений); a58 при рецидиве в сезоне; идемпотентно по `(a49, prev_week)` |
| `week_recap` | cron Вс 18:00 UTC (21:00 МСК), misfire 2 ч | «Итоги недели», см. 7.6 |
| `finalize_season` | cron 1-го числа 09:00 UTC (12:00 МСК), misfire 20 ч, плюс разовый прогон при каждом старте | финал сезона, см. 7.6 |

Ход `_process_new_match`: `get_match` → если игрока нет в матче, ничего
не сохраняется (матч будет скачиваться снова, пока висит в
recentMatches) → `DotaMatch` с `season = season_of(started_at)` →
`request_parse` для неразобранных → `_build_ctx` → `evaluate_match` →
`_apply_and_announce` → `_handle_team` → `bets.settle_for_match` (ошибка
логируется и откатывается).

`_apply_and_announce(db, user, comps, season)`: вставка выполнений, газ
`= max(0, gas + Σ)`, уровень до/после по шкале сезона, ratchet
`comp_max_level` через `level_for_cosmetics`, коммит; затем карточки в
каждый компендиум-чат пользователя (`_compendium_chats_for`: группы с
`compendium_enabled`, флаг включает только создатель группы): kind
`quest` (`{v:1, kind, user_id, username, items:[{name — с хеллоуинской
шкуркой сезона, gas, cat, title?}], gas_total, level, special?, new_level?}`,
пуш только для рампаги) или kind `anti` (без пуша).

`_handle_team(db, row, user)`: группа = строки того же `match_id` с той же
стороной; `team_key = "3-7-12"`, `team_size` пишутся во все строки;
дальше только ещё привязанные; `TeamCtx(size = привязанных)`,
`evaluate_team` каждому; выполнения с сезоном строки; одна карточка на
квест в компендиум-чаты инициатора: `{v:1, kind:"team", user_id,
username, names, who, items, special?:"fullstack"}` (фулл-стак — пуш
«🏆 СТАК ПОБЕДИЛ»).

`_post_card(db, chat, sender, payload, push_title, push_body)` — общая
постилка: `Message(content="/quest_card " + json)` без TTL, WS
`message` всем в чате, пуш всем участникам (включая отправителя) с
`notification_tag = "compendium-{chat_id}"`, канал `messages`.

### 7.5 Ставки газом (`bets.py`, `/api/compendium/bets`)

- Рынки `match` (win/lose), `kills` (over/under, линия = `max(1,
  round(средние убийства))` по последним 20 каткам), `kda` (over/under,
  линия = `max(5, round(10·средний KDA))`, хранится ×10), `roshan`
  (over/under линии 2 рошана команды — нужен парс), `streak` (победная
  серия 2/3/5). Рынка смертей нет («некуда фидить»). Без истории линии
  `kills 5, kda 30`.
- Стейк `STAKE_MIN = 10 .. STAKE_MAX = 500` (хозяин поднял со 100);
  стрик — `{2: 50, 3: 30, 5: 10}`. Выплата ×2, стрик ×2^длина (джекпот
  ≤320). **Ва-банк** (`all_in=true`): стейк = весь газ текущего сезона
  мимо потолка, не на стрик, минимум 10; после коммита
  `_announce_all_in` постит в компендиум-чаты ставящего текст от его
  имени «🎰 ВА-БАНК: … Чел реально еб*нутый, поверил в себя. Ну верим
  верим» (`ALL_IN_ROAST`, фраза хозяина) + пуш остальным без троттлинга;
  ошибка объявления ставку не откатывает.
- Анти-руин: на себя только «за успех» (win/over/streak); ставка на
  другого аннулируется с возвратом, если ставивший сам играл в той
  катке (по `account_id` состава); линии считает сервер; одна открытая
  ставка на пару (ставящий, цель) — проверка + частичный уникальный
  индекс `uq_bets_open_pair WHERE status='open'`; считаются только катки
  с `started_at > placed_at`; ставящий обязан быть привязан.
- Деньги: `try_debit` — атомарный `UPDATE … SET gas = gas − amt WHERE gas
  >= amt` (эскроу при размещении; нет профиля — отказ); `_credit` —
  `INSERT … ON CONFLICT DO UPDATE gas = gas + amt` в профиль **сезона
  катки** + `recalc_max_level`; `_finish`: выигрыш → выплата, проигрыш →
  `recalc_max_level` + `profile_updated` (косметика снимается **только
  при проигрыше**, не при размещении — ревью 02.10); `_void` → статус
  `refunded`, возврат в текущий сезон.
- Резолюция в `settle_for_match` (первая катка цели после размещения):
  стрик копит `progress/progress_at` (поздняя катка задним числом серию
  не путает), рошан без парса «липнет» к `match_id` и ждёт
  `settle_after_parse`; пуши «🎲 Ставка сыграла ✅/❌», карточка
  `bet_result` (одна на катку, все итоги) в компендиум-чаты цели: `{kind:
  "bet_result", target_id, target, match:{is_win, kills, deaths, assists,
  duration}, items:[{outcome, delta, reason?, bettor, market, side, line,
  stake, label}]}`.
- `sweep_expired` (конец `poll_matches`): 24 ч без катки, стрик 7 дней,
  без парса 48 ч → возврат + пуш «🎲 Ставка отменена».
- `recalc_max_level(user)`: `comp_max_level = max(level_for_cosmetics)` по
  сезонам с газом > 0 и снятие косметики ниже порога: badge < 2, title
  < 4 (чемпионские титулы не снимаются), color < 6, цвет второй палитры
  < 14, рамки lime/animated/legend < 8/12/25, `extra.badge_emoji` < 13,
  `glow` < 15, `card_back` < 16, `bubble` < 17, `custom_title` < 19,
  `star` < 30; подиумные рамки не снимаются. Отмены ставок нет
  («поставил — терпи»).
- API: `GET /bets` → `{season, my_gas, linked, stake_min, stake_max,
  streak_stake_max, targets:[{user_id, username, avatar_url, kills_line,
  kda_line, roshan_line, is_me}] (привязанные и одобренные), open (все
  открытые), my_recent (мои 20 последних)}`; `POST /bets` с `BetIn{target_id,
  market, side, line?, stake, all_in}` → `{bet, my_gas, all_in}`.
  `bet_dict`: `{id, bettor_id, bettor, target_id, target, market, side,
  line, label, stake, status, progress, payout, placed_at, resolved_at,
  pending_parse}`.
- Покер «за газ» использует те же `try_debit`/`_credit` с текущим
  сезоном.

### 7.6 Итоги недели, финал сезона, приз (`weekly.py`, `finale.py`, `prizes.py`)

- **Итоги недели** (`week_recap`, Вс 21:00 МСК): окно с Пн 00:00 МСК;
  `top_gas` — сумма положительного газа выполнений (ставки, покер и
  штрафы не входят), топ-3; `winrate` при ≥3 катках, топ-3;
  «Граммар-наци недели» — прирост `users.grammar_errors` над
  `grammar_wk_base`, после чего база срезается **всем**; пустая неделя —
  молчим; пропущенное воскресенье не догоняется. Карточка `week_recap`
  `{kind, week_label, top_gas, winrate, grammar}` во все компендиум-группы
  от имени участника с наибольшим газом (фолбэк создатель) + пуш «📅
  Итоги недели».
- **Финал сезона** (`finalize_season`): гард «1-го числа до полудня МСК —
  рано»; закрывает ВСЕ незакрытые прошлые сезоны (профили с газом > 0,
  у которых нет строк в `season_results`): снапшот таблицы
  (`_standings`: сортировка −gas, тай-брейк ник; `level` по шкале ТОГО
  сезона; `quests_done` без анти, `anti_count`), карточка `season_final`
  `{kind, season, season_name (родительный, MONTHS_GEN), players,
  podium[3], theme?, prize?}` в компендиум-группы от имени лучшего по месту
  участника чата (фолбэк создатель) + пуш «🏆 Итоги сезона». Награды не
  хранятся в колонках: рамки gold/silver/bronze = места 1/2/3 в
  `season_results`, титул «Чемпион <месяца>» = место 1. Поздний парс
  может докапать газ в закрытый сезон — снапшот не пересчитывается
  (осознанно). `_catch_up_prizes` раскрывает призы сезонов, где раскрытие
  упало, по чемпиону из `season_results`.
- **Приз чемпиону** (`prizes.py`): пул `season_prizes(title, hint1..3,
  weight 1..100, active)` ведёт админ (`GET/POST /prizes`,
  `PATCH/DELETE /prizes/{id}`); розыгрыш `POST /prize/draw` — только
  админ, один на сезон (`season_prize_draws` unique), взвешенный
  `random.Random(sha256(f"{season}:{SECRET_KEY}"))`, в розыгрыш
  снапшотятся название и подсказки; тизер `GET /prize` всем: `{season,
  drawn, revealed, hints (открыты по числам HINT_DAYS = 8, 15, 22 МСК;
  прошлый сезон — все), hints_total, next_hint_day, title, winner (после
  раскрытия), last:{season, title, winner}|null}`. Дарит хозяин руками.

### 7.7 Хеллоуин (`halloween.py`)

`theme_for(season)` = `"halloween"` для месяца 10 любого года (само
включается и выключается); `quest_name(q, season)` подменяет названия ~40
заданий «шкурками» (`SKINS`: d01 «Тёмная победа», d13 «Глаза в темноте»,
w20 «Оборотень», s31 «Бессонный», t42 «Шабаш», a50 «Курьер ада» и т.д.) —
описания, предикаты, id и титулы те же, выполнения хранятся по id.
`theme` отдаётся в `/me` и в карточке финала; клиенты рисуют
паутину/паука/🎃 в шапке. Тематические задания на нежить и ночь живут в
`quests.py` круглый год.

### 7.8 API (`api/compendium.py`, префикс `/api/compendium`, JWT)

- `GET /me`: непривязанному — `{linked:false, season, theme,
  intro_version}`; привязанному — `{linked, cosmetics, season, theme,
  intro_version, gas, level, level_progress, level_target, level_cap`
  (30 для сезонов с октября-2026, иначе `null` — клиенты пишут «МАКС» по
  `level >= level_cap`)`, matches, wins, rank_tier, leaderboard_rank,
  daily[5], weekly[7], daily_pool[27], weekly_pool[22], season_quests[15]
  (с progress/target), team[8], anti[16] (done — за текущий сезон),
  trophies (текущий сезон), bingo[20]}`. Элемент задания: `{id, num, name,
  desc, gas, cat, needs_parse, done, progress?, target?, title?}`.
- `PATCH /cosmetics` с `{badge?, title?, color?, frame?, extra?}` —
  валидация по `comp_max_level` (`UNLOCKS`: badge 2, title 4, color 6,
  frame_lime 8, dota_gold 10 (проверяет только клиент), frame_animated 12,
  badge_emoji 13, palette2 14, glow 15, card_back 16, bubble 17,
  custom_title 19 (до 20 символов, любой текст — хозяин в курсе),
  frame_legend 25, star 30); пустое/false снимает; подиумные рамки — по
  месту в `season_results`; титул — из заработанных (чемпионский — с
  любого уровня); `extra` хранится одним JSON `users.comp_extra`
  (`badge_emoji, glow, bubble, custom_title, star, card_back`). Ответ —
  `_cosmetics_dict`: `{max_level, level_cap, badge, title, color, frame,
  extra, earned_titles, palette, palette2, badge_emojis, card_backs,
  unlocks, podium_frames}` + бродкаст `profile_updated`. Палитры:
  `NAME_PALETTE` (10 цветов), `NAME_PALETTE_2` (10, с уровня 14);
  `BADGE_EMOJI` 🎃 💀 👑 🔥 ⚡ 🐺 🦇 🧛 🧟 ☠️ 🕷️ 🌙; `CARD_BACKS` lime,
  blood, gold, pumpkin, ice, void.
- `GET /season` — таблица всех привязанных: `{season, rows:[{user_id,
  username, avatar_url, gas, level, quests_done, anti_count, rank_tier,
  leaderboard_rank, comp_title, comp_color, comp_frame, comp_badge,
  comp_extra}], me}`.
- `GET /seasons` — архив до 12 закрытых сезонов (роут объявлен ПЕРЕД
  `/season`).
- `GET /user/{id}` — чужая полка: трофеи текущего сезона (у тайных `desc`
  «???»), без бинго.
- `GET /bets`, `POST /bets`, `GET /prize`, `GET/POST /prizes`,
  `PATCH/DELETE /prizes/{id}`, `POST /prize/draw` — см. выше.
- `intro_version()` = sha256 первого МБ + размера ролика
  `uploads/compendium/intro.mp4` (12 символов, раз на процесс; `"none"`
  без файла) — клиенты хранят флаг «отключить заставку» вместе с ним,
  новый ролик = заставка снова играет у всех по разу.
- **Бинго** (`_bingo`): клетка на каждую из 20 тайных по `num`, за всё
  время: закрытая — `{id, num, open:false}` (ни имени, ни описания),
  открытая — плюс `name, desc, gas, first_at, count, title?`. Только своё.

### 7.9 Клиент OpenDota (`opendota.py`)

`httpx.AsyncClient` синглтон, таймауты connect 5 / read 25 / write 10 /
pool 10, транспорт `local_address="0.0.0.0"` (строго IPv4 — у VPS сломан
IPv6, хосты за Cloudflare виснут) с `retries=2`, `api_key` при заданном
`OPENDOTA_API_KEY`. Функции: `get_player`, `get_recent_matches`,
`get_match`, `request_parse` (POST `/request/{id}`, ошибки глотаются),
`extract_rank`, `profile_exists`, `resolve_link_input` (принимает
`steamcommunity.com/profiles/<id64>`, `/id/<vanity>` — нужен
`STEAM_API_KEY`, ссылки Dotabuff/OpenDota на игрока, голый steamID64 или
Friend ID). Лимит бесплатного тарифа 2000 вызовов/день и 60/мин:
`DOTA_POLL_MINUTES = 20` рассчитан на 15–20 привязанных, при большем числе
поднимать; поллер спит 1 с между матчами и 0,5 с между людьми. Ошибки
OpenDota в API привязки переводятся в честные 502 (`users._opendota_error`).

### 7.10 Нюансы, о которых стоит знать

- Комментарии в коде кое-где отстали от правок (пул ежедневок «28» —
  на деле 27, «3 ежедневки» — 5, «14 марафонов» — 12 с прогрессом +
  разовые), ориентируйся на код и этот документ.
- Игра с 0–1 убийств и 15+ смертей зажигает a50 (+10), a51 (+15) и a95
  (−25) разом — в сумме 0 газа.
- Штрафные анти опускают газ, но поллер `comp_max_level` только
  поднимает; вниз уровень пересчитается на следующем `_credit` или
  проигранной ставке.
- `_credit` зовёт `recalc_max_level` по газу **после** эскроу открытых
  ставок/энтри покера — выигрыш при другой открытой ставке может на миг
  опустить уровень и снять косметику.
- Для недели на стыке месяцев «Дно недели» получает ключ по месяцу
  понедельника, а сезон выполнения — по воскресенью.
- a53 считает `lane_role == 4` (в OpenDota это джангл) саппортом.
- Парс-зависимые предикаты без явной проверки `is_parsed` опираются на
  нули до парса.

<!-- SECTION:8-desktop -->
## 8. Десктоп-клиент

Код: `client/`. Стек: Electron 31, React 18, TypeScript 5.4, Vite 5,
axios, simple-peer 9 (WebRTC), electron-updater 6, qrcode. Версия в
`client/package.json` (сейчас 2.3.17 на `main`; 2.3.18 — в PR #86) и
дублируется в `APP_VERSION` в `src/renderer/changelog.ts`, откуда её берёт
шапка и окно «Что нового».

### 8.1 Сборка и структура

- Скрипты: `dev` (tsc main-процесса + concurrently `vite` и `electron`),
  `build` (`vite build && tsc -p tsconfig.main.json`), `dist` (`build` +
  electron-builder), `lint` (eslint не установлен — не работает).
- `vite.config.ts`: `root: src/renderer`, `base: "./"`, `envDir: ../../`
  (то есть `client/.env`), `outDir: dist/renderer`, sourcemap в проде
  (чтобы стек-трейсы из DevTools у людей были читаемыми), плагины `react`
  и `nodePolyfills` (simple-peer хочет Buffer/process), alias `@` →
  `src/renderer` (в tsconfig alias не совпадает — не использовать).
- Main-процесс: `src/main/main.ts` + `preload.ts` → `tsconfig.main.json` →
  `dist/main/`. `isDev = NODE_ENV==="development" || !app.isPackaged`; в
  dev грузится `http://localhost:5173`, в проде — `dist/renderer/index.html`.
- `index.html` подключает Google Fonts (Inter, JetBrains Mono); эмодзи —
  встроенный шрифт `assets/fonts/TwemojiGandola.ttf` (COLRv1, собран
  `scripts/build-twemoji-font.py` из @twemoji/svg через nanoemoji; две
  `@font-face` в `global.css`: с `unicode-range` на Emoji_Presentation для
  общих стеков и «Any» для класса `.emoji`).
- electron-builder (`package.json` → `build`): `appId com.gandola.chat`,
  publish GitHub `releaseType: draft`; Windows NSIS oneClick
  `GandolaChat-Setup-${version}.exe`; Linux AppImage + deb; macOS нет.
  Переменные сборки `VITE_API_URL`/`VITE_WS_URL` — из секретов Actions;
  **фолбэки `https://2-26-117-77.sslip.io` / `wss://…` в `api.ts` и
  `ws.ts` обязательны** (пустой секрет однажды сломал релиз).
- Автообновление: electron-updater с GitHub-провайдером;
  `checkForUpdatesAndNotify` на старте в проде; deb-установка (`linux &&
  !APPIMAGE`) отключает autoDownload; события `update:status`
  (available / not-available / downloading / ready / error — error
  рендерер не показывает) → плашки в Sidebar, «Обновить сейчас» →
  `update:install` → `quitAndInstall`.

### 8.2 Main-процесс (`main.ts`) и IPC (`preload.ts`)

Single-instance lock; `BrowserWindow` 1280×800 (мин. 900×600), frameless,
`webSecurity: false`, `backgroundThrottling: false`; закрытие окна
**прячет в трей** (меню трея: Открыть / Выход); F12 и Ctrl+Shift+I
открывают DevTools и в проде; `window.open` → `shell.openExternal`.
Детект Dota: раз в 30 с `tasklist` (только win32) ищет `dota2.exe` →
событие `dota:running` в рендерер → сервис `presence.ts` шлёт
`dota_client_presence` с хартбитом 60 с. Бейдж непрочитанных на иконке
окна/трее рисует рендерер (PNG через canvas) и шлёт в main.

`window.electron` (нетипизированный, везде через `window.electron?.`
гарды — рендерер живёт и в обычном браузере, так гоняются e2e-тесты):

| Канал | Что |
|---|---|
| `window:minimize/maximize/hide/focus` | управление окном |
| `window:close`, `window:quit` | **выход** из приложения (не скрытие — ✕ на форме входа закрывает приложение) |
| `update:check`, `update:install`, событие `update:status` | автообновление |
| `screen:getSources` | источники для шаринга экрана (`desktopCapturer`) |
| `dota:running-get`, событие `dota:running` | детект Dota |
| `badge:set(count, png?)`, `tray:getBaseIcon`, `tray:setImage` | бейдж/трей |
| `app:isDebInstall` | deb → без автозагрузки обновлений |
| `shell:openExternal(url)` | внешние ссылки |
| `file:saveAs(buffer, name)` | «Сохранить как» для вложений |

### 8.3 Рендерер: вход, авторизация, Main

- `index.tsx`: `installLogBuffer()` (первым — буфер консоли для
  «Нашёл баг») → `initTheme()` → render `<App/>` в `ErrorBoundary`.
- `App.tsx`: токен из `localStorage` («запомнить меня») или
  `sessionStorage`; на старте `GET /api/users/me` **ротирует токен**
  (свежий кладётся в то же хранилище); любая ошибка `/me` → оба токена
  стираются и показывается форма входа (в отличие от мобилки, где сеть
  не разлогинивает).
- `pages/Auth.tsx`: вход/регистрация, экран «ждите одобрения». Ошибки
  на `main`: всё без `detail` — «Ошибка. Попробуй снова»; в PR #86
  `describeAuthError`: нет ответа → «Нет связи с сервером (КОД)…» (DNS
  sslip.io / провайдер / VPN / антивирус), 401 / 403 / 429 / 5xx —
  отдельные тексты.
- `pages/Main.tsx` — каркас: кастомный тайтлбар с меню режимов
  **chat / compendium** (режим не сохраняется между запусками — старт
  всегда в чате; старый ключ `gandola-mode` стирается), версия в шапке,
  окно «Что нового» (ключ `gandola-last-version`), все WS-подписки
  приложения, входящие звонки (баннер 20 с, только на `signal.type ===
  "offer"`), реестр `activeCalls` по `call_active`, `pokerChats:
  Set<chatId>` (в каких чатах вместо переписки открыты столы — на сессию),
  ширина сайдбара 180–400. Роутинг по приоритету: Профиль → Инфо группы →
  Гандолиум → Покер (+ колонка `<ChatArea compact>` 380px того же чата,
  тумблер «Переписка», ключ `gandola-poker-chat-column`) → ChatArea +
  MemberList → пустой «Выбери чат». Escape выходит из Гандолиума/покера,
  не сбрасывая чат; клик по чату/уведомлению выводит из Гандолиума.
  Правила merge по WS: `chat_updated` **сохраняет `last_message`**
  (сервер его не шлёт), `profile_updated` мержит в `chat.members` все
  поля включая `comp_extra`, `new_chat` — единственный способ появления
  чата в сайдбаре. Глобальные `window`-события между компонентами:
  `switch-chat`, `chat-last-message-changed`, `set-app-mode`,
  `open-poker-table`, `focus-add-member` (мёртвое — слушателя нет).

### 8.4 Компоненты (`components/`)

- **`ChatArea.tsx`** (~3000 строк) — переписка одного чата: composer на
  `contenteditable` (execCommand-форматирование → markdown), оптимистичная
  отправка с `_temp_id`, команда `/dota` → `POST /api/dota/call`,
  `typing` не чаще 2 с, `mark_read` через IntersectionObserver, подгрузка
  истории вверх, поиск по чату, реплаи, пересылка, закрепы (плашка с
  выпадашкой «ещё N», клик = скролл), 28 реакций в пикере, правка/удаление
  своих, вложения до 10 с подписями и `media_group_id` (мозаика
  альбома), лимиты 50 МБ видео / 10 МБ прочее (как на сервере), превью
  картинок (сохранить/копировать), карточки по маркерам (§6.10):
  `/poll` (голосование, свой вариант, закрыть), `/poker_table`,
  `/dota_call` (ready-лист по WS `dota_ready_update`, запуск
  `steam://rungameid/570`, золотая при `comp_max_level ≥ 10`
  отправителя), `/quest_card` (`QuestCardMsg`: цвета на 4 комбинации
  тема × своё/чужое; тайные — золотые), `/reminder`, `/call_record`.
  Плеер голосовых `VoicePlayer.tsx` (voice_*.m4a и любое аудио по
  расширению; `duration=Infinity` у стримящегося m4a → «–:––»), видео
  `VideoPlayer.tsx` (`<video controls preload=metadata>`, ≤420×320,
  одно играет разом). Шапка: «Столы» (`onOpenPoker`), мьют, поиск,
  звонок; плашка созвона «В созвоне: …» с «Войти» / «Перейти сюда»
  (`takeOverCall`: сперва `call_end` своему другому устройству, ждёт
  состав без себя до 3 с, потом `joinOngoingCall`). Системные уведомления
  и звук — **только для открытого чата** (ChatArea существует на чат);
  в режиме канала не-создатель видит плашку вместо composer'а.
- **`Sidebar.tsx`** — список чатов (группы сверху, значок стола `cards`
  по `GET /api/poker/active`, unread, превью последнего сообщения через
  `markers.ts`), поиск, создание ЛС/группы, заявки на регистрацию для
  админа (`new_pending_user`), меню настроек: тема (discord / neo, цвета
  neo), обновления, выход; бейдж/трей.
- **`MemberList.tsx`** (состав, выход из группы — перезагружает
  страницу), **`GroupInfoPage.tsx`** (описание, админы, тумблер
  Гандолиума, аватар; Escape не закрывает), **`ProfilePage.tsx`** (свой и
  чужой профиль; секция DOTA 2 — привязка/обновить/отвязать, медаль
  `DotaRankBadge`; косметика; в своём — «НАШЁЛ БАГ» (`BugReportSection`:
  textarea + «ОТПРАВИТЬ ЛОГИ»), «МОБИЛЬНАЯ ВЕРСИЯ» — QR на `${BASE_URL}/apk`
  с подписью из `/apk/info` и QR на `${BASE_URL}/app/`; админ-чистка
  сообщений до даты).
- **`CompendiumPage.tsx`** — заставка-оверлей (ролик с `?v=<отпечаток>`,
  чек-бокс «отключить заставку» хранит `{"v": intro_version}` — новый
  ролик снимает флаг, громкость `gandolium.introVolume` по умолчанию
  0,5), шапка уровня/газа («МАКС · 30» на потолке; в октябре
  `HalloweenDecor`), `PrizePanel`/`PrizePoolModal` (админу — розыгрыш и
  пул), вкладки ЗАДАНИЯ / СЕЗОН / СТАВКИ (`BetsTab`, ва-банк через
  `window.confirm`) / ТРОФЕИ / БИНГО (`BingoTab.tsx`, сетка 5 колонок) /
  КОСМЕТИКА (`CosmeticsTab`, замки по уровню, превью рубашек
  `CardBack.tsx`) / АРХИВ; рефетч по WS `/quest_card` и в полночь МСК.
- **`Poker.tsx`** — лобби и стол: форма настроек с пресетами
  (Быстрый / Обычный / Марафон), режим «За газ», места по овалу,
  рубашки соперников (`CardView back=`), `ActionBar` с % банка
  (10/15/25/50/75, рейз до `current_bet + pct×(банк после колла)`),
  Докупиться / История / Сыграть ещё, баннеры паузы докупки и финала,
  звуки; `PokerAssistPanel.tsx` + `pokerAssist.ts` (шпаргалка комбинаций,
  pot odds, ауты 4-и-2, оценка Чена; копия логики в мобилке — править
  обе).
- **`VideoCall.tsx`** — UI звонка: сетка плиток, свободный режим,
  мьют/камера (по умолчанию выкл, `gandola-cam-default`), смена
  микрофона (`switchMicrophone`: «По умолчанию» = `audio:true`, новый
  трек ждём до 4 с, `micEpoch` перезапускает анализатор «говорю»),
  шаринг экрана (с системным звуком на Windows), громкость на участника,
  свёрнутая плашка (`callMiniPos`), ободок «говорит».
- Прочее: `FormattedText.tsx` (markdown-lite + спойлеры + ссылки),
  `Emoji.tsx`/`EmojiPicker.tsx`, `cosmetics.tsx` (`nameColor`,
  `CompBadge`, `CompStar`, `titleOf`, `glowStyle`, `bubbleStyle`,
  `frameStyle` — всё из `comp_*` юзера), `DotaRankBadge.tsx` (медали по
  `rank_tier//10`, звёзды `%10`), `HalloweenDecor.tsx` (SVG-паутина
  кодом), `Icon.tsx` + `icons.ts` (~70 линейных иконок; **кнопки и
  служебные значки — только они**, никаких системных эмодзи в кнопках;
  `<Gas>` = эмодзи ⛽ через шрифт — хозяин настоял), `ErrorBoundary.tsx`.

### 8.5 Сервисы (`services/`)

- **`api.ts`** — axios + все типы ответов; группы `authApi`, `userApi`,
  `chatApi`, `notesApi`, `pollsApi`, `pinsApi`, `dotaApi`, `pokerApi`,
  `compendiumApi` (пути — как в §6.6); перехватчик ошибок пишет в буфер
  репорта `api METHOD path → status detail`.
- **`ws.ts`** — один сокет, реконнект с бэкоффом, ping/качество, массив
  хендлеров на тип (`on/off`), синтетика `_ws_open`; `disconnect()` на
  «Выйти» **стирает все хендлеры** (`handlers.clear()`) — любой сервис-
  синглтон обязан перевешивать подписки при каждом `init()` (ловушка
  №20). В PR #86: `_detachAndClose` (хендлеры старого сокета снимаются до
  close — иначе его `onclose` ставил реконнект и при быстром повторном
  входе жило два сокета), сторож pong (пинг 5 с, три без ответа →
  переподключение; лечит зомби-сокет после сна ноутбука/смены Wi-Fi),
  `_kick` на `online`/`visibilitychange`, код закрытия в лог (1006 —
  сеть, 4001 — токен).
- **`webrtc.ts`** — звонки (детали в §10): `peers`,
  `screenSendingPeers`, `screenReceivingPeers` на simple-peer, ICE: STUN
  Google ×2 + Cloudflare, TURN `2.26.117.77:3478` (UDP; в PR #86 ещё
  `?transport=tcp`), публичный openrelay как ненадёжный фолбэк; очередь
  сигналов по ключу `${uid}:${purpose}:${role}` с chat_id; tie-break;
  пересборка висящего инициаторского peer через 5 с; уступка при глейре;
  ICE-restart инициатором с дебаунсом 2 с; `getConnectionQuality`. На
  `main` `init()` под гардом `_initialized` → после «Выйти → Войти»
  подписки мертвы (звонки не доходят); в PR #86 `init()` перевешивает
  `off`+`on` каждый раз, плюс логи типов кандидатов и выбранного пути.
- **`presence.ts`** — перевешивает хендлер `dota_presence` при каждом
  коннекте, хартбит `dota_client_presence` 60 с.
- **`theme.ts`** — `discord` | `neo` (класс на body + CSS-переменные;
  neo с кастомными bg/accent, моношрифт, нулевые радиусы; ветки `isNeo` в
  компонентах; после переключения остаётся старый `--accent-text`).
- **`markers.ts`** — превью маркеров и файлов для сайдбара и
  уведомлений (`filePreview`: «🎤 Голосовое», «🖼 Фото», «🎬 Видео»);
  **строки превью не трогать** — они же уходят в системные уведомления.
- **`logbuffer.ts`** — кольцо 1200 строк консоли + необработанных
  ошибок, `bugReportMeta()`; `logEvent` зовут ws.ts (open/close/error,
  каждый тип события кроме ping/pong/typing) и перехватчик axios.
- **`sounds.ts`** (WebAudio: уведомление, рингтон), **`changelog.ts`**
  (`APP_VERSION`, `CHANGELOG`), в PR #86 — **`notify.ts`** (реестр
  `Notification` по chat_id, `closeChatNotifications` по WS
  `message_read` своего юзера).

### 8.6 Ключи localStorage

`token` (или в sessionStorage), `gandola-theme`, `gandola-neo-colors`,
`gandola-last-version`, `gandola-poker-chat-column`, `mutedChats`,
`showFormatBar`, `gandola-cam-default`, `callMiniPos`, `poker.oddsHelper`,
`gandolium.introOff`, `gandolium.introVersion`, `gandolium.introVolume`;
`gandola-mode` — удаляется (наследие).

### 8.7 Известные странности

- Большинство компонентов строят URL медиа как `VITE_API_URL ||
  "http://localhost:8000"` (ChatArea, Sidebar, Poker, CompendiumPage,
  MemberList, GroupInfoPage, VideoCall) — https-фолбэк есть только в
  `api.ts`, `ws.ts` и ProfilePage; при пустом `VITE_API_URL` картинки не
  откроются, хотя API заработает.
- Уведомление и звук о новом сообщении приходят только для открытого
  чата (нет глобального слушателя `message` для уведомлений).
- CHANGELOG пропускает 2.3.13. Проверка типов `npx tsc -p tsconfig.json`
  шумит предсуществующими ошибками `import.meta.env`/VideoCall — не
  чинить, правда — `npx vite build`.

<!-- SECTION:9-mobile -->
## 9. Мобильное приложение и PWA

Код: `mobile/`. Одна кодовая база на нативный Android (APK через EAS
Build) и веб-PWA (`expo export -p web`, раздаётся сервером по `/app/`;
iPhone — «Добавить на экран Домой», браузер на компе — широкий режим).
Стек: Expo SDK 57, React Native 0.86 (только новая архитектура), React
19, react-navigation 7, reanimated 4, react-native-webrtc 124,
@notifee/react-native 9, react-native-incall-manager, expo-audio /
expo-video / expo-camera / expo-image-picker / expo-document-picker /
expo-file-system / expo-media-library / expo-notifications /
expo-updates / expo-secure-store, шрифты Inter и JetBrains Mono.
Версия `0.9.2`, `versionCode 11`, `runtimeVersion "9"` (`app.json`).
iOS-натива нет.

### 9.1 Конфигурация и сборка

- `app.json`: `slug gandolachat`, пакет `com.gandola.chat`, тёмная тема,
  `usesCleartextTraffic`, 20 разрешений Android (камера, микрофон,
  Bluetooth(+CONNECT — без него BT-гарнитуры нет в списке), точные
  будильники для напоминаний, `USE_FULL_SCREEN_INTENT`,
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `POST_NOTIFICATIONS`,
  `FOREGROUND_SERVICE` + `_MICROPHONE/_CAMERA/_MEDIA_PROJECTION`),
  веб-секция (`startUrl`/`scope` `/app/`, `experiments.baseUrl "/app"`),
  плагины по порядку: `./plugins/withCallForegroundServiceType`,
  expo-font, expo-secure-store, expo-build-properties, expo-image-picker,
  `@config-plugins/react-native-webrtc`,
  `./plugins/withWebRTCMediaProjection`, expo-audio, expo-camera,
  expo-media-library, expo-notifications (иконка, цвет `#c6ff3d`, канал
  `default`); `extra.apiUrl/wsUrl` (прод), `extra.eas.projectId`,
  `updates.url` (`u.expo.dev/<projectId>`, `fallbackToCacheTimeout 3000`).
  **Любая правка `app.json`/`package.json`/`eas.json` в `main` = сборка
  нового APK** (workflow по путям).
- `app.config.js` оборачивает `app.json`: `googleServicesFile` из
  `$GOOGLE_SERVICES_JSON` (EAS file-env) или `./google-services.json`
  (gitignored), `extra.apiUrl/wsUrl` из `$APP_API_URL/$APP_WS_URL`.
- `src/services/config.ts`: на вебе адрес API — same-origin
  (`https:` → `wss:`), на нативе — `expoConfig.extra`, фолбэк
  `http://localhost:8000`.
- `eas.json`: `appVersionSource: local`; профили `development`
  (dev-client), **`preview`** (APK, канал `preview` — им собирает CI и
  он же прод-канал OTA), `production` (не используется).
- Плагины (`plugins/`): `withCallForegroundServiceType.js` — тип
  foreground-сервиса notifee `microphone|camera` через `tools:replace`
  (библиотечный `shortService` система убивает через несколько минут —
  ANR посреди разговора); `withWebRTCMediaProjection.js` —
  `enableMediaProjectionService = true` в `MainApplication.onCreate` и
  `res/drawable/ic_notification.xml` (без него краш при старте шаринга
  экрана). Оба — чистые функции, проверяются node-скриптом без prebuild.
- `metro.config.js` на платформе web подменяет нативные модули
  заглушками из `web-stubs/`: `react-native-webrtc` → браузерный WebRTC
  (`RTCView` = `<video>`; звонки в PWA работают), `@notifee/react-native`
  → no-op (нет `AndroidForegroundServiceType` — `startCallForegroundService`
  на вебе кидает, ловится, пишет warning), `react-native-incall-manager`
  → no-op (кнопка динамика скрыта), `expo-media-library` → заглушка
  (с SDK 54 его индекс требует натив при импорте — белый экран PWA).
- `scripts/patch-webrtc-types.js` (postinstall): докладывает недостающие
  d.ts rn-webrtc для tsc. `scripts/postbuild-web.js`: префиксует пути
  `/app/…` в `dist/` (идемпотентно) и инжектит статический PWA-head
  (manifest, apple-теги, title «Gandola», theme-color) — рантайм-инжект
  гонялся с iOS «Добавить на экран». `scripts/generate_ring.py` —
  `assets/ring.wav` (рингтон как на десктопе).
- `public/`: `manifest.webmanifest` (`/app/`, standalone), `sw.js` (без
  кэша нарочно; `push` → `showNotification` с `tag chat-<id>`;
  `notificationclick` → фокус окна и `/app/?chat=<id>` — **параметр
  `?chat=` никто не читает**, тап по Web Push открывает приложение без
  перехода в чат; в PR #86 — тихий пуш `{type:"read"}` закрывает
  уведомления чата), иконки (на хеллоуин — тыква).
- `npx expo install` в контейнере агента не работает (прокси);
  матрица версий — `npm pack expo@57` → `bundledNativeModules.json`.

### 9.2 OTA и APK

- OTA: push в `main` с правками `mobile/src/**`, `App.tsx`, `index.ts`,
  `assets/**` → `mobile-ota.yml` → `eas update --branch preview`.
  Телефон проверяет на старте (ждёт до 3 с), ставит при следующем
  запуске; «Проверить сейчас» на экране «Обновления» — `checkForUpdateAsync`
  + `fetchUpdateAsync` → `reloadAsync`. Долетает только до сборок с тем
  же `runtimeVersion`. Правки `plugins/`, `metro.config.js`,
  `web-stubs/`, `scripts/`, `app.config.js` **не триггерят** ни OTA, ни
  APK.
- APK: `mobile-release.yml` (§12) → релиз `mobile-latest` → зеркало на
  VPS (`/apk`, `/apk/info`). `components/UpdateNagModal.tsx` сравнивает
  `build` из `/apk/info` с `Constants.nativeBuildVersion` и показывает
  «Обнови меня до x.x.x» в 1-й, 4-й, 7-й… заход (заход = холодный старт
  или возврат из фона после ≥2 ч; счётчик `gandola.updateNag` на каждую
  сборку зеркала; молчит, пока не закрыто «Что нового»; в PWA нет).
- «Что нового» (`components/WhatsNewModal.tsx`) — по `CHANGELOG_ID`
  (дата батча) в `src/changelog.ts`, ключ `gandola.changelogSeen`;
  версия для OTA не годится (не меняется).
- PWA OTA не использует: обновляется при перезагрузке страницы
  (`sw.js` ничего не кэширует).

### 9.3 Запуск и каркас

- `index.ts` → `registerRootComponent(App)`. Импорт-эффекты:
  `setNotificationHandler`, `initDotaPresence()`, синглтоны `wsService` и
  `webrtcService`. На уровне модуля `App.tsx`:
  `registerCallForegroundRunner()` (система может поднять сервис раньше
  любого компонента — без обработчика ANR через 5 с) и
  `installLogBuffer()`.
- `App.tsx`: шрифты → `SystemUI.setBackgroundColorAsync("#0a0a0a")`,
  `initWebPwa()` (meta viewport, регистрация `/app/sw.js`); дерево
  `GestureHandlerRootView > SafeAreaProvider > ThemeProvider > AuthProvider
  > CallProvider > { KeyboardInset > RootNavigator; WhatsNewModal;
  UpdateNagModal }`.
- `components/KeyboardInset.tsx` — эмуляция adjustResize: в edge-to-edge
  на RN 0.86 штатный `KeyboardAvoidingView` **бесполезен** (ловушка №17);
  высота из `useAnimatedKeyboard` (reanimated) минус `insets.bottom`,
  всё приложение ужимается над клавиатурой.
- `navigation/RootNavigator.tsx`: `null` до готовности AuthContext; тема
  навигатора обязана содержать `fonts` (RN7); `onReady` →
  `initNotificationTapHandler()` + `flushPendingLink()`; `linking` нет
  (схема `gandolachat://` не используется). Стек: `Auth` (Login,
  Register) без токена, иначе `Main` → `MainTabs` (кастомный
  `BottomTabs`: ЧАТЫ / ⛽ ГАНДОЛИУМ / Я). `Chats`-стек: ChatsList, Search,
  NewChat, NewGroup, Chat, GroupChat, ChatInfo, MessageSearch,
  OtherProfile, Poker, MediaViewer (modal), Camera (fullScreenModal);
  `Compendium` — один экран; `Profile`-стек: MyProfile, Settings,
  Updates. Параметры чата (`ChatParams`): `chatId: string`, `name`,
  `userId?` (собеседник ЛС; `null` читается как группа), `avatarUrl?`,
  `isGroup?`, `allowAllWrite?`, `createdBy?`, `isNotes?`,
  `scrollToMessageId?`/`scrollToTick?`. В RN7 `navigate` не возвращается
  к экрану глубже в стеке — вложенные params несут `pop: true`, поиск
  ходит `popTo`.
- `navigation/navigationRef.ts`: `navigateToChat`, `pendingLink` —
  переход из пуша, пришедший до монтирования контейнера (холодный старт),
  выполняется в `flushPendingLink()`.
- **Широкий экран** (`useIsWide`, ≥900px): `MainTabs` рисует ряд —
  слева `ChatsSidebar` (340px, `ChatsListPane`, подсветка открытого чата
  по маршруту), справа табы; оба ребёнка с ключами — смена ширины не
  перемонтирует навигатор. На узком `ChatsList` = `ChatsListPane`, на
  широком — заглушка «выбери чат слева».

### 9.4 Экраны (`src/screens/`)

- **auth/** `LoginScreen` (`auth.signIn`; чек-бокс «запомнить меня»
  косметический — токен хранится всегда; футер `v{APP_VERSION}`),
  `RegisterScreen` (экран «ждите одобрения»).
- **chats/** `ChatsListPane` (AppBar «N / M онлайн», 📝 Заметки через
  `notesApi.open` (404 = «сервер не обновлён»), 🔍 Search, шестерёнка
  **переключает тему**, фильтры Все/Группы/ЛС, pull-to-refresh, FAB →
  NewChat), `SearchScreen` (фильтр списка чатов по имени/последнему
  сообщению), `NewChatScreen` (поиск юзеров с дебаунсом 300 мс →
  `createDm`), `NewGroupScreen` (имя ≤100, тумблер «все пишут», до 6
  участников + создатель), `GroupChatScreen` (обёртка над ChatScreen),
  **`ChatScreen`** (~2400 строк, см. 9.5), `ChatInfoScreen` (аватар/имя/
  описание/админы — создателю; добавить/кикнуть — админам; статистика,
  участники с онлайном, выйти, удалить), `MessageSearchScreen` (**не
  работает**: зовёт несуществующий `chatApi.searchMessages`, результаты
  всегда пустые), `PokerScreen` (лобби с пресетами и режимом «за газ»,
  стол — овал с местами-коробками, радиус от реального размера стола
  (`onLayout`), рубашки соперников, `ActionBar` с % банка, история,
  докупка, таймер паузы докупки, вибрация на свой ход) + `PokerAssist`
  (шпаргалка + «Шансы», ключ `poker.oddsHelper`).
- **extras/** `CameraScreen` (expo-camera, фото → `camera_<ts>.jpg`),
  `MediaViewerScreen` (фото contain или `FullScreenVideo` expo-video с
  нативными контролами и fullscreen; «Сохранить» в футере под
  контентом — оверлей накрывал дорожку перемотки; натив —
  `File.downloadFileAsync` + `MediaLibrary.Asset.create`, веб —
  `window.open`).
- **compendium/** `CompendiumScreen` (me/season/prize, архив лениво;
  рефетч по WS `/quest_card`; шапка с уровнем и `HalloweenDecor`; вкладки
  ЗАДАНИЯ / СЕЗОН (🎮 у играющих сейчас, тап — чужие трофеи) / СТАВКИ
  (`BetsTab`, ва-банк через Alert / `window.confirm` в PWA) / ТРОФЕИ /
  БИНГО (`BingoGrid.tsx`, 4 колонки) / КОСМЕТИКА (`CosmeticsTab`, замки
  по уровню) / АРХИВ).
- **profile/** `MyProfileScreen` (аватар, ник/статус/about, `DotaSection`
  — привязка/обновить/отвязать + тумблер невидимки, смена пароля,
  `WebPushRow` только на вебе (нужен жест), строки: тема, Настройки,
  Обновления с бейджем, Нашёл баг (`BugReportModal`), ВЫЙТИ),
  `OtherProfileScreen`, `SettingsScreen` (тема; админу — заявки и чистка
  сообщений старше 30/90/180 дней), `UpdatesScreen` (версия / сборка /
  runtime / канал, «Проверить сейчас»: OTA и APK независимо; в PWA —
  «обновляется сама» и список изменений).

### 9.5 ChatScreen подробно

- **Дозаполнение params**: если из пуша/поиска пришли неполные параметры
  (нет `avatarUrl`, собеседник отсутствует или равен себе, у группы нет
  `allowAllWrite`/`createdBy`) — берёт карточку чата из `chatApi.list()`
  и `setParams` (собеседник = участник ≠ я). Это лечит и старые серверы,
  где `peer_user_id` в пуше был своим id.
- Канал: `isGroup && allowAllWrite === false && createdBy !== me` →
  вместо composer'а плашка.
- Шапка: назад; аватар+имя → ChatInfo / OtherProfile (в Заметках ничего);
  подзаголовок «печатает…» / онлайн / был(а); 🔍 MessageSearch; 🔔/🔕
  мьют (`mutedChats`, клиентский — сервер пушит всё равно, фильтр в
  обработчике уведомлений); 🎴 Poker; 📞 — развернуть свой звонок /
  `joinOngoing`, если в чате идёт созвон / `startCall` (ЛС).
- Плашка «В созвоне: имена» из `activeCalls` CallContext; закрепы
  (`pinsApi.list` + WS `chat_pins`, первый закреп в плашке, тап — Alert
  со списком).
- Лента: подгрузка старых у верха с `maintainVisibleContentPosition`,
  автоскролл вниз на новое; карточки по маркерам: `/poker_table`,
  `/reminder` (только в Заметках), `/call_record`, `/poll`
  (`PollCardMobile`), `/quest_card` (`QuestCardMobile`: week_recap,
  bet_result, season_final, quest/anti/team, rampage/fullstack, тайные —
  золотые); `/dota_call` **картой не рендерится** (текст). Вложения по
  расширению: аудио → `VoiceMessage`, видео → `VideoMessage` (плашка ▶,
  тап → MediaViewer; инлайн-плеер нарочно нет — нативные контролы не
  выживают под родительским Pressable), картинки → пузырь → MediaViewer,
  прочее — «📎 имя» без открытия; `media_group_id` визуально не
  группируется.
- Жесты: двойной тап = ❤️ (тоггл), долгое нажатие — нижний шит с
  реакциями 👍❤️😂🔥😮😢 и Ответить / Переслать / Закрепить / Копировать /
  Изменить / Удалить (свои), свайп влево — ответить, тап по чипу реакции —
  тоггл.
- WS: `message {chat_id, content, reply_to_id, _temp_id}`, `edit_message`,
  `delete_message`, `forward_message` (выбор чата), `reaction` /
  `remove_reaction`, `typing` не чаще 2,5 с, `mark_read` последнего
  сообщения (повтор на `_ws_open`); `message_read` собеседника →
  галочки на своих пузырях; присутствие в ЛС — `getOnlineUsers` +
  `last_seen` + `user_online/offline`.
- Черновики (`gandola.draft.<chatId>`, дебаунс 500 мс), прыжок к
  сообщению из поиска (до 5 пачек истории, подсветка 1,8 с).
- Скрепка: Фото/видео (ImagePicker images+videos, до 10, ролики >50 МБ
  отсеиваются по `fileSize`), Камера, Файл (DocumentPicker), Опрос
  (вопрос ≤300, 2–12 вариантов, `allow_multi`, `allow_add`; не в
  Заметках). Пачка файлов уходит последовательно с общим
  `media_group_id`, подпись только на первом. **Загрузка — только
  `XMLHttpRequest`** (`api.ts uploadFile`): глобальный `fetch` в SDK 54+
  подменён и не понимает RN-часть `{uri, name, type}` (ловушка №16);
  3 попытки с бэкоффом только на «Network request failed».
- Голосовые (`services/voiceRecorder.ts`): перед записью
  `unloadAllVoicePlayers()`, свежий `AudioRecorder` на каждую запись
  (упавший `prepare` портит объект навсегда), ретрай после
  `resetAudioSubsystem()`, busy-флаг со сторожком 6 с, клипы <800 мс
  выбрасываются, файл `voice_<ts>.m4a`.
- Заметки: ⏰ → `ReminderSheet` (пресеты +30 мин / +1 ч / +3 ч / завтра
  10:00 или день + ЧЧ:ММ, без нативных пикеров) → `notesApi.createReminder`
  + `scheduleLocalReminder`; карточка с отменой.

### 9.6 Сервисы (`src/services/`)

- **`api.ts`** — axios (`baseURL: API_URL`, таймаут 15 с); перехватчик
  запросов читает `gandola.token` из хранилища на каждый вызов;
  перехватчик ответов пишет в буфер репорта; `apiErrorMessage(err)`.
  Группы `authApi`, `userApi`, `chatApi`, `pokerApi`, `notesApi`,
  `pollsApi`, `pinsApi`, `compendiumApi` (пути — §6.6). Аватары — через
  `fetch` multipart (мелкие), файлы чата — XHR.
- **`ws.ts`** — `wsService`: `connect(token)`, пинг 5 с, 3 пропущенных
  понга → close → реконнект (бэкофф `min(1000·2^n, 30000)`), качество
  good/ok/bad по RTT, мгновенный реконнект на AppState active /
  visibilitychange / online / focus (иначе после разворота телефона сокет
  «полумёртв»), синтетика `_ws_open`, `send` возвращает boolean и логирует
  `DROPPED`; `disconnect()` стирает все хендлеры — `webrtc.init` и
  `initDotaPresence` перевешивают свои.
- **`webrtc.ts`** — `webrtcService` на голом `RTCPeerConnection`
  (детали в §10).
- **`CallContext.tsx`** — `useCall()`: `inCall`, `callChatId`,
  `activeCalls`, `startCall`, `joinOngoing`, `expand`; входящий только на
  `offer` и только если меня нет в составе этого звонка (другое
  устройство); гаснет через 20 с локально; рингтон `ring.wav` раз в 5 с
  + вибрация, у звонящего — гудки до входа первого; `accept` — ансвер на
  ожидающий оффер или `joinOngoing` + сторожок 12 с (пуш о звонке
  пришёл, а оффер за время сна телефона пропал); `reject` → `call_end
  {declined: true}` + `discardPending`; foreground-сервис notifee (тип
  MICROPHONE всегда, CAMERA только при включённой камере — иначе система
  отбирает камеру у свёрнутого приложения) переобъявляется на каждый
  тумблер камеры; keep-awake; на возврат из фона `recover("foreground")` и
  перезапуск мёртвой камеры через 600 мс; `InCallManager.start` только
  после подключения первого участника (иначе глушит рингтон);
  `forceSpeaker(on ? true : null)` — `null` = маршрут по умолчанию,
  гарнитура выигрывает (`false` в библиотеке = принудительный EARPIECE);
  включение своей камеры уводит на громкую связь, если кнопку не трогали;
  громкость на участника через `track._setVolume` (0..3, натив), ключи
  `gandola.callVolumes` / `gandola.callSpeaker`. UI: мини-бар свёрнутого
  звонка **в потоке** над навигатором, Modal входящего, Modal звонка
  («назад» сворачивает, не кладёт трубку; плитки экранов сверху, сетка
  1–6, превью себя, кнопки мик/динамик/камера/флип/экран/отбой); на вебе
  невидимые `RTCView` держат звук при свёрнутом звонке.
- **`AuthContext.tsx`** — старт: токен → `/me` → свежий токен, WS,
  `initDotaPresence`, регистрация пушей, ресинк напоминаний. **Токен
  стирается только на 401/403**; сетевые/5xx ошибки — WS подключается
  со старым токеном, `/me` ретраится через 3/5/10/20/30 с (ловушка №10).
  `signOut` снимает пуш-токен и `wsService.disconnect()`.
- **`notifications.ts`** — обработчик показа (напоминания всегда;
  замьюченные чаты — нет; при активном приложении — ничего), каналы
  Android `default` / `messages` (HIGH) / `calls` (MAX, bypassDnd),
  `registerForPushNotifications` (натив — Expo-токен → `POST
  /push-token`; веб — тихая переподписка Web Push), в PR #86 —
  `dismissChatNotifications` / `pruneReadNotifications`.
  **`notificationTapHandler.ts`** — тап по пушу (`type message` →
  `navigateToChat`, `type call` → ещё `raiseInvite` в CallContext);
  холодный старт через `getLastNotificationResponseAsync`.
  **`webPush.ts`** — `webPushState/Enable/Disable/ResubscribeSilent`
  (включение только из жеста). **`reminders.ts`** — локальные
  уведомления `reminder-<id>`, ресинк по AppState/`_ws_open` раз в 60 с.
- **`updates.ts`** (OTA/APK, бейдж, `gandola.updates.lastCheck`),
  **`logBuffer.ts`** (кольцо 1200 строк + `ErrorUtils`; `bugReportMeta`),
  **`callAudio.ts`**, **`callForegroundService.ts`**, **`mutedChats.ts`**,
  **`drafts.ts`**, **`secureStorage.ts`** (expo-secure-store на нативе,
  `localStorage` на вебе; AsyncStorage нет), **`useChats.ts`** (список
  чатов: `allSettled` list + unread + online; тихий рефетч на `new_chat` /
  `message` / `chat_updated` / `chat_deleted` / `_ws_open`; `markerPreview`
  и `filePreview` для превью последнего сообщения), **`useMessages.ts`**
  (страницы по 50, патчи по WS), **`dotaPresence.ts`**,
  **`pokerAssist.ts`** (копия десктопного), `mockData.ts` (мёртвый).
- Темы (`src/theme/`): `neo` (лайм `#c6ff3d` на `#0a0a0a`, JetBrains
  Mono, радиус 0, сканлайны) и `discord` (`#5865f2` на `#36393f`, Inter);
  ключ `gandola.themeId`.

### 9.7 Ключи хранилища

`gandola.token`, `gandola.themeId`, `gandola.mutedChats`,
`gandola.draft.<chatId>`, `gandola.callVolumes`, `gandola.callSpeaker`,
`gandola.changelogSeen`, `gandola.updateNag`, `gandola.updates.lastCheck`,
`poker.oddsHelper`; плюс запланированные локальные уведомления
`reminder-<id>`, PushSubscription браузера, кэш expo-updates.

### 9.8 Известные пробелы

- Поиск по сообщениям на мобилке не работает (`chatApi.searchMessages`
  отсутствует; ещё `theme.colors.bgHover` не существует).
- Тап по Web Push в PWA не открывает чат (`?chat=` не читается).
- `/dota_call` не карточка; чужие файлы (не фото/видео/аудио) не
  открываются; `ChatRow.muted`/`lastStatus` не заполняются — значки 🔕 и
  ✓ в списке не показываются; бейдж у `BottomTabs` не ставится.
- `mobile/README.md` устарел (описывает «скелет первого этапа»; актуальны
  только EAS/OTA-разделы). Актуальный источник — этот документ.

<!-- SECTION:10-calls -->
## 10. Звонки: сквозная картина

Звонок — WebRTC **mesh**: каждый участник держит P2P-соединение с каждым
(до 7). Сервер медиа не касается: он только пересылает сигналы
(`call_signal`), ведёт состав (`call_active`), шлёт пуши и пишет
`/call_record`. Код: сервер `ws/handler.py` + `ws/manager.py`, десктоп
`services/webrtc.ts` (simple-peer) + `VideoCall.tsx` + `Main.tsx`,
мобилка `services/webrtc.ts` (голый `RTCPeerConnection`) +
`CallContext.tsx`.

### 10.1 Сигналинг

- Сообщение `call_signal {chat_id, target_user_id, signal, purpose:
  "webcam"|"screen", role?: "sender"|"receiver"}`; `signal` в диалекте
  simple-peer: `{type: "offer"|"answer", sdp}`, `{type: "candidate",
  candidate: {candidate, sdpMLineIndex, sdpMid}}`, `{renegotiate: true}`,
  `{transceiverRequest}`. Сервер пересылает `send_to_user(target)` на все
  сокеты адресата. Лог `[ws][call_signal] forward … (sockets=N)`:
  `sockets=0` = у адресата нет живого сокета (главный кандидат при
  «звонок не доходит до одного друга»).
- **Состав** (`manager.active_calls` + `call_sockets`): ключуется
  user_id, но привязан к сокету, чтобы выход устройства (дисконнект,
  `call_end`) выводил именно это устройство. `call_active {chat_id,
  user_ids}` бродкастится всем чатам (и ЛС) при **смене состава**, после
  каждого `call_end`/дисконнекта/таймаута (пустой список = звонок
  кончился) и снимком каждому новому сокету. Клиенты сбрасывают реестр на
  `_ws_open` под свежий снимок.
- **Кто офферит**: позвонивший — своему адресату; при входе в идущий
  звонок (`call_join`) или появлении нового участника в `call_active`
  недостающие пары собирают клиенты по **tie-break: меньший user_id
  офферит**. Глейр (два оффера навстречу): побеждает меньший id, второй
  откатывается (мобилка `rollback`, десктоп уступает responder'ом).
  Повторный join уже участвующего юзера игнорируется — mesh по user_id,
  **вторым устройством в тот же звонок войти нельзя** (десктоп
  «Перейти сюда» сперва выкидывает своё другое устройство через
  `call_end`).
- **Первый сигнал в чате** создаёт `call_meta {initiator, started,
  answered}`, шлёт пуш «Входящий звонок» (канал `calls`, `tag
  call-{chat}`) и ставит `_missed_call_timeout(chat_id, meta)` на 60 с:
  никто не ответил → `call_end {timeout: true}` участникам, состав
  чистится, пустой `call_active`, запись `/call_record cancelled|0|n|
  initiator`. Таймер привязан к **своей** записи по identity — до 02.10
  таймер первого звонка через минуту закрывал следующий звонок в том же
  чате. `call_end {timeout:true}` клиент трактует как «сервер закрыл
  звонок целиком» и сворачивает всё.
- Другим сокетам того, кто послал первый сигнал, летит `call_taken
  {chat_id}` — его другие устройства гасят входящий и молчат до
  `call_end`. `call_end` рассылается чату без сокетов отправителя плюс
  адресно его же другим устройствам.
- Клиенты **звонят только на `signal.type === "offer"`**; подавление
  «я уже в этом звонке где-то» — по членству в реестре `call_active`
  (самоочищается; отдельный набор протухал навсегда). Баннер входящего
  живёт 20 с и гаснет локально (без `decline`); гаснет по `call_end`
  только от себя или от звонящего (выход третьего не глушит).
- Сигналы до принятия копятся в очереди с chat_id (`pending`), флаш
  применяет только сигналы текущего чата и только если среди них есть
  оффер; «Отклонить» и пустой `call_active` сбрасывают очередь
  (`discardPending`) — иначе после отклонения отвечали мёртвому офферу, а
  чужой чат получал фантомный входящий.

### 10.2 Медиа и живучесть

- Старт всегда **аудио**; камера по умолчанию выключена. Видео-линия
  есть всегда: мобилка при создании peer'а добавляет `addTransceiver
  ("video", {direction:"sendrecv", streams:[localStream]})` — `streams`
  обязателен (даёт msid; без него десктопный simple-peer не видит
  дорожку вовсе), десктоп — аналогично в simple-peer. Включение камеры =
  `replaceTrack` (+ `_renegotiate`, если `currentDirection` у слота
  null); выключение — `replaceTrack(null)` + stop (гаснет индикатор);
  `signal.renegotiate` от десктопного респондера → мобилка добавляет
  recvonly-транссивер и офферит.
- ICE-серверы: STUN Google ×2 (+ Cloudflare на десктопе), **свой coturn
  `turn:2.26.117.77:3478`** по UDP (в PR #86 — и `?transport=tcp` для
  сетей, где режут UDP; на VPS нужен ufw 3478/tcp и отсутствие `no-tcp`
  в turnserver.conf), публичный openrelay как фолбэк. Учётка
  статическая. Диагностика (PR #86): в логах `signal out/IN` тип
  кандидата host/srflx/relay + udp/tcp, на ICE connected — выбранный
  путь `[WebRTC] webcam path to N: local=… ↔ remote=…` (ни одного relay
  у человека = TURN ему недоступен).
- Восстановление: мобилка — роли из tie-break (`initiators`), на
  `disconnected` через 2 с ICE-restart инициатором, на `failed` — сразу
  + сторож 20 с (инициатор) / 30 с (респондер) → свежий peer; десктопный
  simple-peer на `failed` уничтожает себя и принимает новый оффер как
  обычный входящий. Сигналы одного собеседника применяются строго по
  очереди (`chains`); исходящие при закрытом сокете — в `outbox` (≤60),
  доотправка на `_ws_open` + `recover()`. Наш инициаторский peer без SDP
  другой стороны через 5 с после `call_active` пересобирается по
  tie-break'у (висяк прозвона). На десктопе close/error старого peer'а
  игнорируются, если слот уже занят новым (simple-peer шлёт close
  микротаской после замены).
- Экран: отдельный peer на каждого участника с `purpose: "screen"`;
  шарящий — всегда инициатор (`role: "sender"`), приёмная сторона
  отвечает с `role: "receiver"`; опоздавшему участнику экранный peer
  открывается при создании webcam-peer'а; `screen_share_status
  {sharing}` гасит плитку сразу. Десктоп шарит через `desktopCapturer`
  (с системным звуком на Windows), телефон — `getDisplayMedia` с
  `resolutionScale 0.6` (Android 14+ требует foreground-сервис
  mediaProjection — см. плагин), PWA в десктопном браузере — тоже
  `getDisplayMedia`.
- Мобильный фон: foreground-сервис notifee типа `microphone|camera`
  (манифест через плагин + типы в рантайме, обе части обязательны — иначе
  ANR «short service did not stop» и система отбирает камеру у свёрнутого
  приложения), keep-awake, восстановление `recover("foreground")` и
  перезапуск мёртвой камеры на возврате. Звук: `InCallManager` только
  на активном звонке; громкая связь ↔ динамик; персональная громкость
  `track._setVolume`.
- Мультиустройство: один юзер может быть и на компе, и на телефоне;
  входящий показывают оба, ответивший «забирает» звонок (`call_taken`);
  умерший телефон выходит из состава по дисконнекту сокета.

### 10.3 Запись звонка

По завершении сервер постит `/call_record kind|dur|n|initiator`
(`completed` / `missed` / `declined` / `cancelled`), клиенты рисуют
карточку «Звонок» с длительностью и числом участников.

### 10.4 Что уже ломалось (кратко; подробности в §14 и `CLAUDE.md`)

- «Вечное ожидание подключения» — порты coturn vs ufw не совпадали.
- Умерший телефон висел в составе до конца звонка (чистка была только при
  полном оффлайне юзера).
- Таймер «не взяли» закрывал чужой следующий звонок (привязка по chat_id).
- После «Выйти → Войти» на десктопе звонки мертвы в обе стороны
  (`webrtc.init` под гардом, WS-хендлеры стёрты) — PR #86.
- Два сокета после быстрого перелогина — каждое событие дважды, оффер
  применялся дважды — PR #86.
- Зомби-сокет после сна ноутбука: сервер выкинул, клиент «всё нормально»,
  человек у всех оффлайн — сторож pong в PR #86.
- Включённая на телефоне камера на компе чёрная — не было msid у
  видеодорожки.
- Висяк «Присоединиться» — инициаторский peer без ансвера, пересборка
  через 5 с.

<!-- SECTION:11-notifications -->
## 11. Уведомления: сквозная картина

Три канала: **WS-события** для живых клиентов (десктоп и открытая
мобилка показывают уведомления сами), **Expo Push** для нативного
Android (`push_tokens`), **Web Push** для PWA/iPhone
(`web_push_subscriptions`, VAPID). `push.send_push(db, user_ids, title,
body, data, …)` бьёт в оба пуш-канала разом; `webpush.py` —
pywebpush в тредпуле, VAPID-ключи генерятся сами в `uploads/vapid/`,
мёртвые подписки (404/410) вычищаются.

### 11.1 Что и когда шлёт сервер

| Событие | Кому | Канал/тег | Троттлинг |
|---|---|---|---|
| Текст, файл, опрос в чате | участники без живого сокета в чате (оффлайн или в другом чате) | `messages`, `tag chat-{id}` | **15 с на чат** (`_recent_push`; пачка фото = один пуш) |
| `/dota_call` | все участники | `tag dota-{id}` | нет |
| Входящий звонок | участники чата кроме звонящего | `calls` (MAX, bypassDnd), `tag call-{id}` | нет |
| Карточки Гандолиума | все участники компендиум-чатов, включая отправителя | `tag compendium-{id}` | только громкие: rampage / fullstack / week_recap / season_final |
| Итог ставки | ставивший | `{type:"bet"}` | нет |
| Ва-банк | остальные участники компендиум-чатов ставящего | `tag allin-{id}` | нет |
| Баг-репорт | получатель | `tag bug-{id}` | нет |
| Напоминание | владелец Заметок | только Web Push, `tag reminder-{rid}`; натив планирует локально | нет |
| Тихий `{type:"read", chat_id}` (PR #86) | читатель на других устройствах | Web Push без title/body | один раз после пуша типа message, не позже 12 ч |

Данные пуша `message`/`call` несут `chat_id`, `chat_name` (для ЛС — имя
отправителя/звонящего, иначе тап открывал чат «Чат»), `is_group`,
`peer_user_id` = **отправитель/звонящий** (собеседник для получателя; до
22.09 три из четырёх мест клали id самого получателя, и деп-линк
открывал ЛС «с самим собой»), `message_id` / `from_user_id`.

### 11.2 Клиенты

- **Десктоп**: системные `Notification` + звук — только для открытого
  чата (ChatArea); остальное — бейдж в сайдбаре/трее. Мьют чата —
  `mutedChats` в localStorage.
- **Мобилка натив**: `setNotificationHandler` решает показывать ли —
  напоминания всегда, замьюченные чаты нет, при активном приложении
  ничего (живой экран сам обновится). Каналы `default` / `messages` /
  `calls`. Тап: `notificationTapHandler` → `navigateToChat` (+ плашка
  входящего для `type call`, потому что оффер за время сна телефона
  пропал — «Принять» идёт через `call_join`). Холодный старт из пуша →
  `pendingLink` до готовности навигатора.
- **PWA**: `sw.js` показывает уведомление с `tag chat-<id>` (схлопывает
  серию из одного чата); включение — кнопка «Уведомления» в профиле
  (iOS требует жест), на старте тихая переподписка. Тап открывает
  `/app/?chat=<id>` — чат при этом **не** открывается (параметр не
  читается).

### 11.3 Сквозное гашение (PR #86)

«Прочитал на компе — на телефоне уведомление пропадает»:

1. Живые устройства гасят сами по WS `message_read` своего юзера (он
   летит всем сокетам читателя, без `exclude_user`): десктоп —
   `services/notify.ts` (`closeChatNotifications` из Main.tsx), мобилка —
   `notifications.ts dismissChatNotifications` (натив —
   `getPresentedNotificationsAsync` + `dismissNotificationAsync` по
   `data.chat_id`, тип `call` не трогаем; веб —
   `serviceWorker.ready → getNotifications()`), плюс
   `pruneReadNotifications` по `GET /chats/unread/counts` при каждом
   рефетче списка (холодный старт, `_ws_open`) — снимает уведомления
   чатов, прочитанных пока приложения не было.
2. PWA/iPhone с закрытой страницей — сервер: `push.send_read_sync` из
   `mark_read` шлёт тихий Web Push `{type:"read", chat_id}`, `sw.js`
   закрывает уведомления этого чата и ничего не показывает (Chrome
   изредка рисует «сайт обновлён в фоне» — принято). Чтобы не слать на
   каждый `mark_read`, `_note_pushed` помнит `(user, chat) → время`
   последнего пуша типа `message`; тихий пуш уходит один раз после него и
   не позже `READ_SYNC_WINDOW_SEC` (12 ч).
3. Убитое нативное приложение: data-only Expo-пуш без expo-task-manager
   (нативный модуль = новый APK) не обрабатывается — уведомление
   пропадёт при следующем запуске (прунинг). Осознанно.

### 11.4 Прочее

- `read_receipts` + `message_read` дают и кросс-девайс прочитанность
  (клиенты гасят свой unread), и галочки у собеседника.
- `new_pending_user` — админам в реальном времени (заявки в Sidebar и в
  настройках мобилки).
- «Что нового» — не пуш, а локальное окно по версии (десктоп) /
  `CHANGELOG_ID` (мобилка).

<!-- SECTION:12-ci -->
## 12. Сборка, CI/CD

Три workflow в `.github/workflows/`. Отменить или перезапустить прогон
из сессии агента нельзя (403 на Actions у интеграции) — только хозяин
руками; логи задачи API отдаёт только после её завершения.

### 12.1 `release.yml` — десктоп

- Триггер: push тега `v*`. `permissions: contents: write`.
- `build-linux` (ubuntu, checkout@v4, Node 20): `npm ci && npm run dist` в
  `client/` с `GH_TOKEN`, `VITE_API_URL`, `VITE_WS_URL` из секретов →
  electron-builder **создаёт черновик** релиза с AppImage, deb,
  `latest-linux.yml`.
- `build-windows` (`needs: build-linux`, windows-latest): докладывает
  `GandolaChat-Setup-x.y.z.exe`, `.blockmap`, `latest.yml` в тот же
  черновик. Последовательно нарочно — параллельные джобы гонялись за
  черновиком (v2.1.8).
- Хозяин жмёт Publish; electron-updater у людей читает `latest*.yml`.
  Комплект — 6 файлов. В плохой вечер выгрузка ассетов идёт по 6–9 минут
  на файл — «сделал 2 файла и встал» это не поломка (ловушка №15);
  «Cancel» → «Re-run all jobs» доложит недостающее, черновик и тег не
  удалять.

### 12.2 `mobile-release.yml` — APK

- Триггеры: тег `mobile-v*`; push в `main` с изменением
  `mobile/app.json`, `mobile/package.json`, `mobile/eas.json` (фильтр на
  `google-services.json` никогда не сработает — файл gitignored);
  `workflow_dispatch` с `publish` (bool, дефолт false).
- `build-android` (ubuntu, 180 мин, checkout@v5, Node 22): `npm install`,
  `eas-cli`, `eas build --profile preview --platform android
  --non-interactive --json` (ждёт облачную сборку, ~1 час), jq →
  `applicationArchiveUrl`, curl → `gandolachat.apk`; сводка прогона с
  версией/versionCode/runtime и ссылкой EAS (там же QR для установки);
  артефакт `gandolachat-apk` 14 дней.
- Publish (только при push/теге или `publish=true`): `gh release delete
  mobile-latest --cleanup-tag` → `gh release create mobile-latest
  gandolachat.apk --prerelease --title "GandolaChat Android ${VERSION}
  (сборка ${VCODE})"`. Prerelease — чтобы десктоп оставался «Latest».
  Формат названия парсит `apk_mirror._parse_release_name` — не менять.
  Постоянная ссылка `releases/download/mobile-latest/gandolachat.apk`;
  людям раздаётся с VPS через `/apk` (GitHub-CDN в РФ душится).
- Секреты: `EXPO_TOKEN`, `github.token`. На стороне EAS: file-env
  `GOOGLE_SERVICES_JSON`, опционально `APP_API_URL`/`APP_WS_URL`.
- Тестовая сборка с ветки без публикации: Run workflow → ветка,
  `publish=false` → APK артефактом + ссылка EAS. Так хозяин проверяет
  натив на телефоне до мержа; мерж в `main` = публикация в `mobile-latest`,
  куда смотрит «обнови меня» у всех.

### 12.3 `mobile-ota.yml` — OTA

- Триггеры: push в `main` с изменением `mobile/src/**`, `mobile/App.tsx`,
  `mobile/index.ts`, `mobile/assets/**`; `workflow_dispatch` с `branch`
  (preview | production, дефолт preview) и `message`.
- Job (ubuntu, checkout@v4 `fetch-depth: 0`, Node 20): `npm install`,
  `eas-cli`, `eas update --branch $BRANCH --message "<input или тема
  последнего коммита>" --non-interactive`. Секрет `EXPO_TOKEN`.
- JS-правки на тестовую сборку без нового APK: Run workflow → git-ветка
  PR, EAS branch `preview` → получают только сборки с тем же
  runtimeVersion (тестовая); ставится при следующем запуске (открыть
  дважды).
- «preview» здесь и есть прод-канал: и тестовые сборки, и публикуемый
  APK собраны профилем `preview`, OTA с `main` уходит в EAS-ветку
  `preview`. Профиль/ветка `production` из `eas.json` не используются.

### 12.4 Сервер и PWA — без CI

Сервер деплоится руками на VPS (`git pull && docker compose build server
&& docker compose up -d server`), PWA — командой из таблицы §5.
`docker-compose.dev.yml` — оверрайд для разработки: `uvicorn --reload` и
bind-mount `./server:/app` (`docker compose -f docker-compose.yml -f
docker-compose.dev.yml up`).

### 12.5 Dockerfile сервера

Multi-stage: `postgres:16-bookworm AS pgtools` → `/pgtools` (pg_dump,
pg_restore + библиотеки по ldd, без libc) копируется в
`python:3.12-slim-bookworm` в `/opt/pgtools` с обёртками в
`/usr/local/bin`; `RUN pg_dump --version && pg_restore --version` —
образ не соберётся с битым бинарником. **Обе стадии прибиты к bookworm и
меняются только парой** (ловушка №13). `COPY . .`, `PYTHONUNBUFFERED=1`,
CMD uvicorn на 8000.

<!-- SECTION:13-testing -->
## 13. Локальная проверка и тесты

**В репозитории автотестов нет.** Все тесты и сквозные сценарии,
упомянутые в `CLAUDE.md`, живут в scratchpad агента (вне репо) и
пропадают с пересозданием контейнера — их пишут заново под задачу. Если
понадобится постоянный набор — заводить `server/tests/` (pytest на живом
Postgres) и `scratchpad/pw/*.js` → `e2e/`; пока это не сделано.

### 13.1 Сервер

- Окружение: `cd server && python -m venv venv && venv/bin/pip install -r
  requirements.txt`; быстрая проверка синтаксиса `python -m compileall
  app/`.
- **Живой Postgres** в контейнере агента (`/usr/lib/postgresql/16/bin`):
  ```
  su nobody -s /bin/sh -c "initdb -D /tmp/gandola-pgtest/data --auth=trust -U gandola"
  su nobody -s /bin/sh -c "setsid nohup pg_ctl -D /tmp/gandola-pgtest/data -o '-p 5433 -k /tmp/gandola-pgtest' -l /tmp/gandola-pgtest/log start"
  createdb -h localhost -p 5433 -U gandola gandola
  ```
  (без `-k` сокет лезет в `/var/run/postgresql` и падает по правам;
  перед повторным стартом удалить `postmaster.pid` и `.s.PGSQL.5433*`).
- Env для тестов: `DATABASE_URL=postgresql+asyncpg://gandola:gandola@
  localhost:5433/gandola SECRET_KEY=test-secret UPLOAD_DIR=/tmp/
  gandola-uploads-test`; миграции `python -m alembic upgrade head` из
  `server/` (там `alembic.ini`); тесты запускать **из `server/`**.
- Приёмы: HTTP — fastapi `TestClient` + `create_access_token(user_id)`
  (login не нужен); WS — `c.websocket_connect(f"/ws?token=…")`, читать
  исходящие удобно прямо из `ws._send_queue.get(timeout=…)` (потоки на
  `receive_json` виснут); БД внутри TestClient-теста — через
  `c.portal.call(coro)`; после любого `asyncio.run` перед TestClient —
  `await engine.dispose()` (иначе asyncpg «another operation is in
  progress»). Поллер компендиума — monkeypatch `app.opendota.*` фейками
  и дёргать джобы напрямую; движок заданий тестируется без БД
  (`SimpleNamespace`-строки + `UserCtx`).
- Смоук «как в октябре»: uvicorn с подменой `current_season → "2026-10"`,
  сид пользователей (`seed_pwa.py`: gandola-админ, Костян, Марк, пароль
  `pass1234`), сид привязок/профилей/косметики.
- Глушить сервер: `for p in $(pgrep -f "python -m uvicorn app.main:app");
  do [ "$p" != "$$" ] && kill "$p"; done` — `pkill -f` с той же строкой в
  команде убивает собственную оболочку (ловушка №18).

### 13.2 Десктоп

- `cd client && npm install && npx vite build` — правда о типах и сборке
  (`npx tsc -p tsconfig.json` шумит предсуществующими ошибками — не
  чинить, фильтровать).
- Рендерер в браузере против локального сервера:
  `VITE_API_URL=http://127.0.0.1:8000 VITE_WS_URL=ws://127.0.0.1:8000
  ./node_modules/.bin/vite build` (**в foreground и через локальный
  бинарник**: фоновый bash теряет `cd`, а `npx vite` из чужого каталога
  скачивает vite 8 и падает на «Cannot resolve entry module index.html»),
  потом `python3 -m http.server 5174` из `client/dist/renderer`. Всё
  электронное — через `window.electron?.`-гарды, в браузере работает.

### 13.3 Мобилка и PWA

- `cd mobile && npm install` (postinstall патчит типы rn-webrtc) → `npx
  tsc --noEmit` (шум: TS1323 и две старые ошибки MessageSearchScreen — не
  чинить).
- Веб-бандл: `EXPO_OFFLINE=1 CI=1 npx expo export -p web --output-dir
  dist --clear && node scripts/postbuild-web.js`; симлинк `server/web →
  mobile/dist` (gitignored) **до** старта uvicorn (`/app` монтируется на
  старте, иначе 404). Белый экран = смотреть `pageerror` в консоли
  (модуль без веб-реализации → стаб в `metro.config.js`).
- Натив без Android SDK: `npx expo prebuild --platform android
  --no-install --template <tgz>` (шаблон — `npm pack
  expo-template-bare-minimum@sdk-57`; `google-services.json` — пустышка)
  → проверить манифест / `MainApplication.kt` / res, потом `rm -rf
  android google-services.json`. Плагины — чистые функции, гоняются
  node-скриптом.
- Что не ловится ничем, кроме телефона: подмена глобального `fetch`,
  нативные модули при импорте на вебе, SurfaceView поверх оверлеев,
  нативные контролы под Pressable (ловушка №16). Поэтому нативный батч
  идёт тестовой сборкой (`publish=false`) и правится по находкам хозяина.

### 13.4 Сквозные сценарии (Playwright)

Playwright из глобальных модулей (`NODE_PATH=$(npm root -g)`), Chromium
предустановлен. Типовые сценарии, которые уже писались и стоит
повторять при правках:

- Звонок PWA ↔ десктоп с камерой: Chromium с
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`
  (фейковая камера — зелёный «пакман»), телефон звонит, десктоп принимает
  (сперва закрыть «Понятно» у «Что нового» — оно накрывает баннер),
  телефон включает камеру → на десктопе `[data-tile-id="remote-<id>"]
  video` с `videoWidth > 0`; обратный сценарий — десктоп включает камеру
  позже. Селекторы: мобилка — `aria-label` кнопок (Позвонить / Принять /
  Отклонить / Микрофон / Камера / Показ экрана / Завершить), десктоп —
  `title` кнопок («Звонок», «Включить камеру», «Завершить звонок»).
- Звонок после «Выйти → Войти» на десктопе (два контекста; успех —
  `[WebRTC] webcam CONNECTED to peer` у обоих; перелогин без `page.goto`,
  иначе перезагрузка JS прячет баг).
- Скриншоты PWA 400×800 и десктопа: Гандолиум в октябре, БИНГО, косметика,
  стол покера («встать» посреди турнира: место пропадает, в API
  `is_active=false`), просмотр видео (в headless Chromium нет H.264 —
  серый ролик это не баг), заставка со сбросом флага (ролик подменяется
  WebM с канваса).
- В PWA кнопка входа ищется по `/ВОЙТИ/` (neo-скобки); из Гандолиума на
  десктопе выходить Escape'ом («✕» в тайтлбаре закрывает окно).

## 14. Ловушки, на которые уже наступали

Каждый пункт — реальная поломка. Нумерация совпадает с «граблями» в
`CLAUDE.md`.

1. **Identity map SQLAlchemy.** Сессии созданы с `expire_on_commit=False`;
   повторный `select` после ручного INSERT отдаёт устаревший объект из
   identity map. Перечитывать только с
   `.execution_options(populate_existing=True)` (так сделано для покерных
   мест).
2. **rollback экспайрит всё.** После `rollback()` в async-коде обращение к
   атрибуту ORM-объекта даёт `MissingGreenlet` (даже внутри лога в
   `except`). В фоновых джобах держать снапшоты примитивов и заново
   выбирать объекты на каждую итерацию.
3. **IPv6 на VPS сломан.** Хосты за Cloudflare (OpenDota) виснут до
   таймаута. httpx-клиенты прибиты к IPv4 (`local_address="0.0.0.0"`) —
   не убирать.
4. **Релизы десктопа.** Черновик + последовательные джобы (Linux → Windows).
   Параллельный запуск уже давал гонку (v2.1.8). Публикует хозяин.
5. **Сообщения вечные.** Авто-TTL снят давно; не вешать `expires_at` на
   новые типы сообщений (карточкам компендиума его уже снимали).
6. **Подделка серверных маркеров.** `/quest_card` и `/poll N` режутся из
   пользовательского текста в трёх местах: новое сообщение, правка,
   подпись к файлу. Новый серверный маркер или новый путь создания
   сообщения — добавлять в те же щиты.
7. **Адреса сервера в клиентах.** Пустой `VITE_API_URL` в секретах уже
   однажды дал сборку со сломанным адресом; в `api.ts`/`ws.ts` зашит
   https/wss-фолбэк на прод — не убирать. `SECRET_KEY` стабилен.
8. **`chat_updated` без last_message.** Клиенты мержат событие, сохраняя
   превью последнего сообщения; «упрощать» нельзя.
9. **Состояние прода ≠ репозиторий.** nginx, certbot, coturn, `.env`
   живут на VPS; проверять ветку и прод, а не только код.
10. **Мобильный `/me` на старте.** Сетевые и 5xx-ошибки не разлогинивают
    — токен выкидывается только на 401/403, иначе PWA с ярлыка
    разлогинивала людей при секундном отсутствии сети.
11. **OTA ходит по `runtimeVersion`, и он ручной.** Любое нативное
    изменение без бампа = JS, зовущий отсутствующий натив, краш у всех.
    Любой бамп `version` без надобности раньше заставлял всех качать APK.
12. **GitHub CDN душится у российских провайдеров.** Большие файлы для
    людей раздаются со своего VPS (`/apk`), GitHub — источник для зеркала.
13. **Плавающие теги базовых образов** (`python:3.12-slim`, `postgres:16`)
    переезжают на новый Debian и ломают сборку сначала как неразрешимый
    apt, потом тихо (бинарник под другой glibc). Все стадии Dockerfile
    прибиты к bookworm парой, скопированный `pg_dump` проверяется в
    самой сборке (`RUN pg_dump --version`).
14. **PR смержили, пока агент пушил.** См. §5: проверять `merged` перед
    каждым push, после мержа — новая ветка от `main` и новый PR.
15. **Релиз «сделал 2 файла и встал».** Выгрузка ассетов в GitHub в
    плохой вечер идёт по 6–9 минут на файл; Windows-джоба ждёт Linux.
    Это не поломка: смотреть Actions, при зависании «Cancel» → «Re-run
    all jobs», черновик и тег не удалять. Комплект — 6 файлов.
16. **Мажорный апгрейд Expo меняет рантайм, а не только API.** SDK 57
    подменил глобальный `fetch` (сломались загрузки файлов — теперь только
    XHR), expo-media-library на вебе требует натив при импорте (белый
    экран), RTCView рисуется поверх оверлеев, нативные контролы
    expo-video не живут под Pressable. Ничего из этого не ловится tsc —
    только руками на телефоне через тестовую сборку.
17. **KeyboardAvoidingView на Android в edge-to-edge не работает** (RN
    0.86): клавиатуру объезжает корневой `KeyboardInset` по инсету IME
    через reanimated.
18. **`pkill -f "uvicorn app.main:app"` убивает свою же оболочку**, если
    строка запуска есть в той же команде. Глушить через цикл `pgrep` с
    исключением `$$`. Симлинк `server/web` создавать до старта uvicorn.
19. **Уровень — величина сезонная.** Все вызовы `level_for_gas` обязаны
    передавать сезон; зачёт в `comp_max_level` только через
    `level_for_cosmetics` (старые сезоны считаются не выше 12).
20. **`wsService.disconnect()` на «Выйти» стирает все WS-подписки**
    десктопа. Любой сервис-синглтон с `wsService.on` обязан перевешивать
    подписки при каждом `init()` (off перед on), а не под гардом «уже
    инициализирован». Симптом: `ws ← call_signal` в логе есть, а
    `[WebRTC] signal IN` нет.

## 15. История ключевых решений

Хронология того, что и почему решал хозяин (подробности и цитаты — в
`CLAUDE.md`, раздел «Бэклог»):

- **Сентябрь 2026.** Единый стиль десктопа «вариант Б»: кнопки — линейные
  иконки, эмодзи — встроенный шрифт Twemoji; значок газа остаётся
  эмодзи ⛽ (линейную колонку вернули назад по просьбам). Покер стал
  частью чата, а не отдельным режимом (люди «проваливались» в столы).
  Многоустройственные звонки, живучесть при смене сети, экран с
  телефона. Мобилка переехала на Expo SDK 57 нативным батчем 0.9.0 с
  тестовой сборкой до мержа. Офсайт-бэкапы на Koofr. «Кружки»
  (видеосообщения) отложены в бэклог.
- **30.09–01.10.** Октябрьский сезон Гандолиума: шкала уровней до 30
  (сентябрь не пересчитывается), хеллоуинская тема и шкурки названий,
  108 заданий (5 ежедневок и 7 недельных активных), именные ачивки от
  хозяина, два штрафных анти-задания, косметика уровней 13–30, новая
  заставка, бинго тайных, хеллоуинская иконка.
- **02.10.** Ставки до 500 и ва-банк с объявлением в чат, рубашки карт в
  покере (уровень 16), громкость заставки 50%, кнопка «Нашёл баг» с
  логами файлом хозяину (получатель — только хозяин, настройка
  `BUG_REPORT_TO`), запуск всегда в чат. Косметика при ставке снимается
  только при проигрыше.
- **02–03.10.** Разбор первых баг-репортов: звонки после «Выйти → Войти»,
  таймер «не взяли» по своему звонку, сторож соединения, диагностика
  пути звонка, TURN по TCP, понятные ошибки входа (PR #86). «Яшка в
  Тельняшке» стала сезонной (PR #87). Сквозное гашение уведомлений между
  устройствами.
- **Отклонено хозяином:** «страховка от дна» (сжечь газ, чтобы стереть
  анти-ачивку) — анти-ачивки вечные.

## 16. Бэклог и отложенное

- **«Кружки»** — круглые видеосообщения как в Telegram (мобилка через
  expo-camera, десктоп через MediaRecorder, обычное видео с именем
  `circle_<ts>`), без нового APK. Отложено хозяином.
- **Косметика фаза 2** (ждёт «давай»): неоновая рамка, фон профиля, реролл
  задания, рамка аватара в покере, второй слот титула, корона,
  дота-карточка, золотой ник в покере, зал славы.
- **Шрифт Twemoji в PWA** — по желанию.
- **Нативный батч** (новый APK): expo-task-manager для гашения
  уведомлений в убитом приложении, react-native-keyboard-controller,
  хеллоуинская иконка нативного приложения (и возврат обычной в ноябре).
- **Свой домен** вместо sslip.io, если подтвердятся проблемы DNS у
  провайдера одного из друзей.

## 17. Как поддерживать этот документ

- Меняешь API, WS-события, модель данных, задания, экраны, сборку —
  правь соответствующий раздел в том же PR. Документ описывает код, а
  не намерения.
- Исторические и «почему» заметки лучше дописывать в `CLAUDE.md` (там
  живёт история решений хозяина), сюда — только устоявшееся.
- Ссылки на файлы давай относительно корня репозитория; номера строк не
  указывай (устаревают), указывай имена функций.
- В конце документа — дата последней сверки с кодом.

_Последняя сверка с кодом: 2026-10-04 (ветка `main` после PR #87)._
