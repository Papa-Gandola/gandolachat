# GandolaChat — карта проекта (для Клода)

Discord-подобный мессенджер для чата друзей (~50 чел). Личный проект Гандолы
(Papa-Gandola). Общение — по-русски; хозяин на Windows 11, знает Java/Python.
Рабочий цикл: фича по запросу → ветка → PR → хозяин мержит → деплой по
правилам ниже. Ключевые фичи поверх мессенджера: покер, /dota-созыв и
**Гандолиум** — сезонный компендиум по рейтинговым каткам Dota 2.

## Прод-топология

- VPS (~$6). Хостовый **nginx + certbot**: `https://2-26-117-77.sslip.io` →
  `localhost:8000`. Порт 8000 наружу закрыт, всё только https/wss.
  nginx/certbot настроены НА VPS, в репо их нет.
- **docker-compose**: `db` (postgres:16, том `pgdata`) + `server` (образ из
  `server/Dockerfile`, `COPY . .`). Тома: `uploads:/app/uploads` (именованный)
  и bind `./server/web:/app/web` (PWA-бандл, деплой = скопировать файлы).
- **coturn** — СИСТЕМНЫЙ сервис на VPS (не docker). Диапазон
  min-port/max-port в `/etc/turnserver.conf` обязан совпадать с окном ufw
  (49160–49200) — уже ловили «вечное ожидание подключения» из-за этого.
- Секреты: `SECRET_KEY` (env; менять НЕЛЬЗЯ — инвалидирует все JWT),
  GH Actions: `VITE_API_URL`/`VITE_WS_URL` (https/wss!).

## Правила деплоя («что менял → что делать»)

| Менялось | Действия |
|---|---|
| `server/` | VPS: `git pull && docker compose build server && docker compose up -d server`. Миграции и синк ассетов — сами при старте. Релиз НЕ нужен |
| `client/` | Бамп версии в **двух** местах: `client/package.json` + строка `v2.x.x` в `client/src/renderer/pages/Main.tsx` (+`npm i --package-lock-only`). После мержа: `git tag v2.x.x && git push origin v2.x.x` → Actions собирает **черновик** релиза (Linux создаёт, Windows докладывает — последовательно, гонку уже чинили) → хозяин жмёт Publish release |
| `mobile/` | PWA: на VPS `cd mobile && npm run build:web` → скопировать `mobile/dist/*` в `server/web/` (bind-mount, рестарт не нужен). Скрипт `postbuild-web.js` префиксует пути `/app`. Нативный Android — тег `mobile-v*` (EAS), версия mobile своя (0.6.x) |
| только docs | ничего |

Ошибся тегом: удалить И черновик релиза на GitHub, И тег
(`git tag -d vX && git push origin :refs/tags/vX`), потом заново.

## Сервер (`server/`, FastAPI + SQLAlchemy 2.0 async + PostgreSQL)

Запуск: `uvicorn app.main:app`. В lifespan: alembic upgrade → синк
`assets/compendium/intro.mp4` в uploads → APScheduler-джобы.

- `app/main.py` — app, CORS, статика `/uploads` и `/app` (PWA), WS-роут
  `/ws?token=`, джобы: cleanup_expired_messages (удаляет ТОЛЬКО сообщения с
  выставленным expires_at — обычные ВЕЧНЫЕ), поллер компендиума.
- `app/config.py` — Settings (env/.env): DATABASE_URL, SECRET_KEY,
  UPLOAD_DIR, MAX_FILE_SIZE_MB=50, MESSAGE_TTL_DAYS (наследие, к сообщениям
  не применяется), OPENDOTA_API_KEY/STEAM_API_KEY (опц.), DOTA_POLL_MINUTES=20.
- `app/database.py` — движок, `AsyncSessionLocal(expire_on_commit=False)`.
- `app/models.py` — User (+ dota_*: steam_id64 строкой, dota_account_id
  BIGINT UNIQUE, rank_tier, linked_at; + comp_*: max_level/badge/title/color/
  frame), Chat (allow_all_write=режим канала, admin_ids JSON-строкой,
  compendium_enabled), Message (reply_to, media_group_id, expires_at),
  Reaction, chat_members, read_receipts, PushToken (Expo), PokerTable/Seat,
  DotaMatch, CompendiumProfile, QuestCompletion.
- `app/auth.py` — bcrypt + JWT (7 дней), get_current_user.
- `app/api/auth.py` — register (is_approved=False → админам WS
  `new_pending_user`), login (403 до одобрения), approve/reject (админ),
  change-password. Админство — только колонкой is_admin (руками в SQL).
- `app/api/users.py` — /me (MeOut: плоско + вложенно, бэккомпат токен),
  search, PATCH /me, аватар; **Steam**: POST/DELETE `/me/steam`,
  `/me/steam/refresh`. При привязке ДРУГОГО аккаунта строки DotaMatch юзера
  удаляются (не смешивать историю), linked_at сбрасывается. Гонка двойной
  привязки ловится unique-индексом → 400. `_broadcast_profile` — единый
  payload profile_updated (ник/аватар/статус/dota/comp), `_opendota_error` —
  перевод сетевых ошибок в честные 502 + лог `[steam-link]/[steam-refresh]`.
- `app/api/chats.py` — список (последнее сообщение, unread), dm/group
  (группы ≤7), members add/kick, PATCH чата (создатель: name/description/
  admin_ids/compendium_enabled → `chat_updated` без last_message!), leave/
  delete, messages (limit/before_id), search, файлы ≤50MB (+caption,
  media_group_id для мозаики), read-status, unread counts, online,
  stats, админ-чистка сообщений до даты. Caption с `/quest_card` режется.
- `app/ws/manager.py` — ConnectionManager: мультисокеты на юзера,
  chat_users, active_calls + call_meta (для /call_record), broadcast_to_chat
  (_eid дедуп), send_to_user, дроп мёртвых сокетов.
- `app/ws/handler.py` — вход: ping, message (маркер `/quest_card` дропается —
  анти-спуф; счётчик grammar_errors по регэкспам), typing, dota_ready/
  dota_ready_request (эфемерный ready-лист карточки /dota_call, TTL 3ч),
  forward_message, reaction/remove_reaction, mark_read, video/screen/mute
  status, edit_message (тоже режет `/quest_card`), delete_message,
  poker_action/poker_request_state, call_signal/call_end (WebRTC-сигналинг
  через сервер, mesh P2P ≤7; по завершении пишется `/call_record kind|dur|
  n|initiator`). Исходящие: message, message_edited/deleted, reaction_*,
  user_online/offline, typing, new_chat, chat_updated/deleted,
  profile_updated, new_pending_user, dota_ready_update, poker_table_
  created/updated/removed, poker_state, call_signal/call_end.
- `app/push.py` — Expo push (native Android). Троттлинг 15с/чат для обычных
  сообщений; /dota и рампага/фулл-стак — без троттлинга. Web Push для PWA
  НЕ подключён (sw.js зарегистрирован «на будущее»).
- Покер: `poker_engine.py` (колода, оценка 7→5), `poker_game.py`
  (síт-энд-гоу: блайнды растут по времени, сайд-поты, шоудаун, GameStore —
  **in-memory**, рестарт сервера убивает раздачу), `api/poker.py` (столы в
  БД, join/leave/start/close; после commit — перечитка с
  `populate_existing=True`, см. грабли №1).
- `app/api/dota.py` — POST /call: сообщение `/dota_call` + пуш всем.

### Гандолиум (компендиум) — `app/compendium/`

- **Смысл**: сезон = календарный месяц по МСК (UTC+3 фикс). Только ranked
  (lobby_type=7), только катки после dota_linked_at. Газ ⛽ → уровень =
  gas//100+1. Карточки постятся в групповые чаты с `compendium_enabled`.
- `quests.py` — все 70 заданий: daily (16, ротация 3/день), weekly (14,
  3/нед, сброс Пн), season (10 марафонов с progress), team (8), anti (10),
  secret (12, в UI скрыты до выполнения). `repeat`: period/match/day/week →
  period_key; уникальность `(user, quest, period_key)` в БД. Титулы у
  громких (Рампага, Безупречный, Фулл-стак, Доминатор, Восходящий + позорные
  a49/a50/a53/a56/a58). Детекция ролей: саппорт = 5+ вардов (📼), кор =
  120+ ластхитов. Ротации детерминированы сидом от даты — рестарт не меняет.
- `engine.py` — UserCtx (строки за 60 дней, ключи выполнений, стрики,
  day/week_rows), TeamCtx (lineup_prev_result для «Спина к спине»/«Реванша»),
  evaluate_match/evaluate_team, extract_player_facts (разбор /matches/{id}:
  мультикиллы, варды, руны, рошаны своей стороны, аегисы по слоту, own_rax
  по маске бараков, итемы для рапиры id=133; parsed = version!=null).
- `poller.py` — джобы: poll_matches (каждые DOTA_POLL_MINUTES),
  recheck_parses (20 мин, дотягивает 📼 до 8 попыток/36ч, сам заказывает
  парс), refresh_ranks (час; «Восхождение» = рост МЕДАЛИ rank_tier//10;
  пустой rank_tier НЕ затирает старый), weekly_roast (Пн 03:25 МСК, cron
  00:25 UTC c misfire_grace 20ч; «Дно недели» мин. 5 игр, худший винрейт,
  тай-брейк больше поражений; рецидив → «Якорь сезона»). ВСЕ джобы под
  общим `_JOB_LOCK` (asyncio) — иначе гонки за газ/дубли. Циклы ходят по
  СНАПШОТАМ простых значений и перечитывают User свежим select-ом
  (rollback экспайрит сессию — см. грабли №2). Отвязанные отфильтрованы
  везде (анти-подмена анонимами: у них account_id=null). Командные: 2+
  привязанных в одном match_id на одной стороне (не по party_id!),
  team_key/size пишутся в строки; карточка одна на квест со всеми именами.
  Карточки: `/quest_card {json}` (kind: quest/anti/team; special:
  rampage/fullstack; items, gas_total, level, new_level) — БЕЗ expires_at.
- `api/compendium.py` — /me (ротации+done, марафоны с прогрессом, анти done
  только текущего сезона, трофеи, cosmetics), /season (таблица привязанных),
  /user/{id} (чужая полка), PATCH /cosmetics (валидация по comp_max_level —
  вечному максимуму: значок ур.2, титул ур.4 из заработанных, цвет ур.6 из
  NAME_PALETTE, рамка lime ур.8 / animated ур.12; золотой /dota ур.10 —
  авто). UNLOCKS/палитра — там же.
- `app/opendota.py` — клиент: **строго IPv4** (`local_address="0.0.0.0"` —
  лечит зависший IPv6 VPS), таймауты connect=5/read=25, retries=2.
  resolve_link_input: /profiles/id64, /id/vanity (нужен STEAM_API_KEY),
  Dotabuff/OpenDota-ссылки, голый steamID64 или Friend ID. Лимит free:
  2000/день, 60/мин — при >20 привязанных поднять DOTA_POLL_MINUTES.
- Тизер: `server/assets/compendium/intro.mp4` (в репо, H.264+AAC) — lifespan
  копирует в uploads-том → `/uploads/compendium/intro.mp4`. Замена видео =
  замена файла в репо.
- Миграции `alembic/versions/`: 0001 базовая, 0002 push_tokens,
  0003 компендиум, 0004 косметика, 0005 BIGINT+unique на dota_account_id.
  Только добавления; прогоняются сами на старте.

## Клиент десктоп (`client/`, Electron + React + Vite)

- `src/main/main.ts|preload.ts` — frameless окно, IPC (minimize/maximize/
  hide/quit/openExternal). В браузере всё через `window.electron?.` гарды.
- `services/api.ts` — axios + ВСЕ типы. `BASE_URL = VITE_API_URL ||
  "https://2-26-117-77.sslip.io"` — https-фолбэк обязателен (v2.1.8 сломался
  пустым секретом). `services/ws.ts` — реконнект, ping/quality, МАССИВ
  хендлеров на тип (on/off). `services/markers.ts` — превью служебных
  маркеров (сайдбар + уведомления). `services/theme.ts` — темы "discord" |
  "neo" (класс на body + CSS-переменные; neo с кастомными bg/accent из
  localStorage). Всё стилится через var(--*), у neo — mono-шрифт и нулевые
  радиусы (`isNeo` ветки в каждом компоненте).
- `pages/Main.tsx` — тайтлбар с меню режимов **chat / poker / compendium**
  (localStorage "gandola-mode"), версия приложения в шапке, WS-подписки,
  входящие звонки, роутинг Профиль/Инфо группы/Покер/Гандолиум/Чат.
  Клик по чату/уведомлению и Escape выводят из Гандолиума.
- `ChatArea.tsx` (большой) — переписка: маркеры контента → карточки:
  `/poker_table N`, `/dota_call` (ready-лист по WS, запуск
  `steam://rungameid/570`, золотая при comp_max_level≥10 отправителя),
  `/quest_card {json}` (QuestCardMsg: цвета рассчитаны на 4 комбинации
  тема×своё/чужое — своё сообщение = цветной пузырь!), `/call_record ...`.
  Реакции, реплаи, эдит (execCommand-форматирование), пересылка, поиск,
  мозаика медиагрупп, уведомления с markerPreview, цвет ника+⛽ из
  косметики (по chat.members).
- `CompendiumPage.tsx` — тизер-оверлей (каждый вход, loop, чек-бокс
  «отключить заставку» = localStorage gandolium.introOff, по умолчанию
  показывается), шапка уровня/газа, вкладки ЗАДАНИЯ/СЕЗОН/ТРОФЕИ/КОСМЕТИКА,
  обновление по WS `/quest_card` и в полночь МСК, клик по вкладке = рефетч,
  ошибка сезона ≠ «никто не привязал».
- `ProfilePage.tsx` — профиль+редакт, секция DOTA 2 (привязка/обновить/
  отвязать, бейдж звания, подсказка про «общедоступную статистику» только
  своему), рамка/титул/значок косметики, админ-чистка сообщений.
- `DotaRankBadge.tsx` (медали Рекрут…Титан, tier=rank_tier//10, звёзды %10),
  `cosmetics.tsx` (nameColor/CompBadge/CompTitle/frameStyle; анимированная
  рамка — класс comp-frame-animated в global.css), `PokerAssistPanel.tsx` +
  `pokerAssist.ts` (шпаргалка комбинаций + pot odds/ауты 4-2, чистая логика
  с юнит-тестами), `Poker.tsx`, `VideoCall.tsx` (mesh ≤7, шаринг экрана),
  `Sidebar.tsx` (чаты, поиск, создание, unread, превью маркеров, настройки
  тем, admin-заявки), `MemberList.tsx`, `GroupInfoPage.tsx` (описание,
  админы, тумблер Гандолиума), `FormattedText.tsx` (маркдаун+спойлеры).
- **Typecheck**: `npx tsc -p tsconfig.json` шумит предсуществующим
  `import.meta.env`/VideoCall — НЕ чинить, фильтровать. Правда — `npx vite
  build`. Сборка релиза: `npm run dist` (electron-builder, releaseType
  draft).

## Мобилка/PWA (`mobile/`, Expo SDK 51 + RN)

Один код на Android-натив и веб-PWA (iPhone: Добавить на экран «Домой» с
`https://…/app/`). metro.config подменяет нативные модули (webrtc, notifee)
веб-стабами. Экраны: chats/* (ChatScreen рендерит те же маркеры карточек,
включая QuestCardMobile; PokerScreen), profile/*, auth. useChats — превью
маркеров (локальная копия markerPreview). Пуши: Expo (native); web push НЕ
подключён. Экрана Гандолиума на мобилке НЕТ (только карточки в чате) —
бэклог. Версия своя (0.6.x, app.json+package.json).

## Локальная проверка (как я гоняю без окружения хозяина)

- Сервер: venv + `pip install -r requirements.txt`; компиляция
  `python -m compileall app/`; **живой постгрес**: в контейнере есть
  `/usr/lib/postgresql/16/bin` — initdb/pg_ctl от `nobody` в /tmp, порт 5433,
  `DATABASE_URL=postgresql+asyncpg://gandola:gandola@localhost:5433/…
  python -m alembic upgrade head`. Интеграционные тесты: monkeypatch
  `app.opendota.*` фейками и дёргать поллер напрямую; HTTP — fastapi
  TestClient + `create_access_token(id)` (login не нужен).
- Клиент: `npm install && npx vite build`. Движок компендиума тестируется
  без БД (SimpleNamespace-строки + UserCtx).

## Грабли (уже кусали — не наступать)

1. **Identity map**: expire_on_commit=False + повторный select после ручного
   INSERT = стейл-объект. Перечитка — только с
   `.execution_options(populate_existing=True)` (покерные места).
2. **rollback экспайрит всё**: обращение к атрибуту после rollback в async =
   MissingGreenlet (даже в логе внутри except). В джобах — снапшоты
   примитивов + свежий select на итерацию.
3. **IPv6 на VPS сломан**: Cloudflare-хосты (OpenDota) виснут до таймаута.
   httpx-транспорт прибит к IPv4 — не убирать.
4. **Релизы**: черновик + последовательные джобы (Linux → Windows). Публикует
   хозяин руками. Параллельность возвращать нельзя (гонка v2.1.8).
5. **Сообщения ВЕЧНЫЕ**: авто-TTL давно снят, чистка только админ-кнопкой.
   Не вешать expires_at на новые типы сообщений (карточкам уже снимали).
6. **`/quest_card` спуф**: щиты в трёх местах (новое сообщение, edit,
   caption файла) — при новых путях создания сообщений добавлять четвёртый.
7. **SECRET_KEY** стабильный; `VITE_API_URL` пустой в секретах = клиент со
   сломанным адресом (https-фолбэк в api.ts/ws.ts — страховка, не убирать).
8. **chat_updated** идёт без last_message — клиенты мержат с сохранением
   превью; не «упрощать».
9. Проверяй ВЕТКУ и СОСТОЯНИЕ ПРОДА, не только репо: nginx/certbot/coturn
   живут на VPS; «этого нет в репо» ≠ «этого нет».

## Бэклог (обсуждалось, не сделано)

Финал сезона: авто-подиум в последний день месяца (🥇 рамка, аватарка
позора голосованием, соц-ставки) + рамки gold/silver/bronze зарезервированы
в косметике. Экран Гандолиума на мобилке. Покер-ассист на мобилке. Web Push
для PWA (sw.js уже есть). «Страховка от дна» (сжечь 300⛽ — стереть
анти-ачивку), фонд сезона. README.md устарел (2 дня/7 человек) — обновить
при случае.
