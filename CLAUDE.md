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
| `client/` | Бамп версии в **двух** местах: `client/package.json` + `APP_VERSION` в `client/src/renderer/changelog.ts` (+`npm i --package-lock-only`); ТАМ ЖЕ дописать пункты в CHANGELOG — окошко «Что нового» покажется каждому один раз после обновления (Main.tsx версию берёт отсюда). После мержа: `git tag v2.x.x && git push origin v2.x.x` → Actions собирает **черновик** релиза (Linux создаёт, Windows докладывает — последовательно, гонку уже чинили) → хозяин жмёт Publish release |
| `mobile/` | PWA: на VPS `cd mobile && npm run build:web` → скопировать `mobile/dist/*` в `server/web/` (bind-mount, рестарт не нужен; Node 20 на VPS стоит). Скрипт `postbuild-web.js` префиксует пути `/app`. Нативный Android: изменение mobile/app.json\|package.json\|eas.json в main (или тег `mobile-v*`) → Actions ждёт сборку EAS и сам публикует APK в скользящий релиз **mobile-latest** — постоянная ссылка `releases/download/mobile-latest/gandolachat.apk` (на неё смотрит QR в профиле десктопа). При новом APK поднимать И version, И versionCode (appVersionSource: local). Версия mobile своя (0.7.x). При заметном батче правок поднять `CHANGELOG_ID` (дата) в `mobile/src/changelog.ts` + дописать пункты — мобильное «Что нового» (версия для OTA не годится, она не меняется) |
| только docs | ничего |

Ошибся тегом: удалить И черновик релиза на GitHub, И тег
(`git tag -d vX && git push origin :refs/tags/vX`), потом заново.

## Сервер (`server/`, FastAPI + SQLAlchemy 2.0 async + PostgreSQL)

Запуск: `uvicorn app.main:app`. В Dockerfile PYTHONUNBUFFERED=1 — иначе
print-логи видны в `docker compose logs` с опозданием (не убирать).
В lifespan: alembic upgrade → синк
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
  change-password. Reject удаляет ТОЛЬКО не-одобренных (гард: промах по
  id действующего юзера снёс бы его каскадом с сообщениями и архивом
  сезонов). Админство — только колонкой is_admin (руками в SQL).
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
- Пуш-данные message/call несут chat_name; для ЛС (chat.name=NULL) —
  имя отправителя/звонящего, иначе тап по пушу открывал чат «Чат».
  `message_read` бродкастится ВСЕМ сокетам чата, включая другие
  устройства читателя — клиенты гасят по нему свой unread (кросс-девайс
  прочитанность: Sidebar на десктопе, useChats на мобилке).
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
  n|initiator`). Мультиустройство звонков: первый сигнал юзера в звонке →
  его же сокетам летит `call_taken {chat_id}` (другие устройства гасят
  входящий и молчат до call_end); call_end рассылается чату БЕЗ сокетов
  отправителя + отдельным send_to_user самому отправителю (его другим
  устройствам); call_active бродкастится для ВСЕХ чатов (и ЛС — клиенты
  лечат mesh) при СМЕНЕ СОСТАВА (не на каждый кандидат — спам), ПОСЛЕ
  каждого call_end/дисконнекта/60с-таймаута (пустой список = звонок
  кончился) и СНИМКОМ каждому новому WS-подключению. `call_join {chat_id}`
  — вход в УЖЕ идущий звонок: сервер регистрирует участника (active
  перечитывается ПОСЛЕ db-await'ов — гонка с последним отбоем; повторный
  join уже участвующего юзера игнорируется — mesh по user_id; вход
  инициатора «ответом» не считается) и рассылает call_active, mesh
  дособирают клиенты tie-break'ом (меньший id офферит); join в МЁРТВЫЙ
  звонок → адресный пустой call_active (клиентский сторожок 12с добьёт
  повисший вход). Клиенты звонят ТОЛЬКО на signal.type=offer, подавление
  «я уже в этом звонке где-то» — по членству в call_active-реестре
  (самоочищается; НЕ отдельный набор — тот протухал навсегда), реестр
  сбрасывается на реконнекте (_ws_open) под свежий снимок; баннер гаснет
  по call_end только от СЕБЯ или от ЗВОНЯЩЕГО (выход третьего из группы
  звонилку не глушит) и по пустому call_active; входящий живёт 20с и
  гаснет ЛОКАЛЬНО (не decline). call_end с timeout:true = сервер закрыл
  звонок целиком — клиент сворачивает ВСЁ (иначе звонящий вечно «в
  звонке»). Исходящие: message,
  message_edited/deleted, reaction_*, user_online/offline, typing,
  new_chat, chat_updated/deleted, profile_updated, new_pending_user,
  dota_ready_update, poker_table_created/updated/removed, poker_state,
  call_signal/call_end/call_taken/call_active, dota_presence (смена
  состава + снимок на подключение).
- `app/push.py` — send_push бьёт в ОБА канала: Expo (native Android) и
  Web Push (`app/webpush.py`, PWA/айфоны — VAPID-ключи генерятся сами в
  uploads/vapid/, pywebpush в тредпуле, мёртвые подписки 404/410
  вычищаются; подписки в web_push_subscriptions, миграция 0006; ручки
  /api/users/web-push*). Троттлинг 15с/чат для обычных сообщений; /dota и
  рампага/фулл-стак — без троттлинга.
- `app/apk_mirror.py` — зеркало Android APK: джоба (старт + каждые 30 мин)
  качает свежий `gandolachat.apk` из релиза mobile-latest в `uploads/apk/`
  (сравнение по updated_at в meta.json, .part + atomic rename, sync-httpx
  в тредпуле, IPv4). Закачка `_download_resumable`: VPS тоже в РФ, GitHub
  ему душат так же — выходим сразу по счётчику байт (close не ждём!),
  обрывы докачиваем через Range, 12 попыток, read-таймаут 30с. `GET /apk`
  отдаёт файл с правильным mime; пока кэша нет — 302 на GitHub. QR в
  профиле десктопа смотрит СЮДА (грабли №12). Ручную заливку файла в
  `uploads/apk/` синк не затирает (обновит только скачав новый целиком).
- `app/backups.py` — ночные дампы БД: 04:00 МСК `pg_dump -Fc` в
  ОТДЕЛЬНЫЙ том `backups:/app/backups` (НЕ uploads — тот публичен!),
  ротация 14 шт., pg_dump-16 в Dockerfile КОПИРУЕТСЯ из образа
  postgres:16 (multi-stage + ldd-сбор библиотек БЕЗ libc, обёртки с
  LD_LIBRARY_PATH в /usr/local/bin) — PGDG из РФ шаток, а главное
  плавающий python:3.12-slim уехал на trixie и bookworm-PGDG стал
  неразрешим (exit 100). База сервера прибита к python:3.12-slim-bookworm
  — не отпинывать: плавающий тег уже ломал сборку сменой дистрибутива.
  Достать: `docker compose cp
  server:/app/backups/<файл> ./`; восстановить: pg_restore --clean
  --if-exists -h db -U gandola -d gandolachat (затирает базу!).
- `app/notes.py` — «Заметки»: личный чат (Chat.is_notes=True, один участник,
  лениво через GET /api/chats/notes) + напоминания (таблица reminders,
  миграция 0007): POST/GET/DELETE /api/notes/reminders, карточка
  `/reminder {json}` в Заметках (клиенты рендерят её ТОЛЬКО в is_notes-чате
  — анти-спуф), джоба раз в 30с: срок → «⏰ текст» в Заметки + пометка
  карточки fired + Web Push. Expo-пуш НЕ шлём: нативный андроид планирует
  ЛОКАЛЬНОЕ уведомление сам (mobile/services/reminders.ts — работает без
  интернета; ресинк списка после логина покрывает другие устройства).
- Покер: `poker_engine.py` (колода, оценка 7→5), `poker_game.py`
  (síт-энд-гоу: блайнды растут по времени, сайд-поты, шоудаун, GameStore —
  **in-memory**, рестарт сервера убивает раздачу), `api/poker.py` (столы в
  БД, join/leave/start/close; после commit — перечитка с
  `populate_existing=True`, см. грабли №1).
- `app/api/dota.py` — POST /call: сообщение `/dota_call` + пуш всем.
- `app/steam_presence.py` — «🎮 в Доте сейчас»: джоба раз в 2 мин,
  GetPlayerSummaries батчами по 100 (IPv4-клиент opendota, грабля №3),
  in-memory набор, WS `dota_presence {playing}` при СМЕНЕ состава +
  снимок каждому новому сокету. Невидимка: users.dota_presence_visible
  (дефолт true, тумблер в профиле; PATCH /me гасит значок сразу через
  drop_user; перед публикацией опроса состав пересекается с актуальным
  visible-набором — гонка тумблера с летящим опросом). Ошибка Steam —
  состав НЕ трогаем (не мигать). Без STEAM_API_KEY джоба спит.
  КЛИЕНТЫ: хендлер dota_presence перевешивается initPresence()/
  initDotaPresence() при каждом коннекте — логаут стирает ВСЕ
  WS-хендлеры (тот же класс бага, что чинили в webrtc.init).

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
  `_post_card(db, chat, sender, payload, push_title/body)` — общий постилка
  карточек (поллер + финал).
- `bets.py` — **ставки** ⛽ на катки (свои и чужие): рынки match/kills/
  kda/roshan/streak (смертей НЕТ — некуда фидить). Анти-руин: на себя
  только «за успех» (win/over), ставка на другого аннулируется если
  ставивший сам в катке (по account_id состава), линии kills/KDA — от
  средних цели (20 каток, «принтер» не собрать), стейк 10..100 (стрик
  меньше: выплата ×2^K, джекпот ≤320). Эскроу списывается сразу
  атомарным UPDATE (gas >= stake), выплата/возврат — атомарным UPSERT в
  профиль сезона КАТКИ + ratchet comp_max_level. Резолюция в
  _process_new_match (первая катка цели с started_at > placed_at; стрик
  копит progress/progress_at — поздняя катка задним числом серию не
  путает), рошан-ставка липнет к катке (match_id) и ждёт recheck_parses.
  TTL-возвраты в sweep_expired (конец poll_matches): 24ч без катки,
  стрик 7 дней, без парса 48ч. Карточка `/quest_card kind=bet_result`
  (одна на катку, все итоги) в компендиум-чаты цели + адресные пуши.
  Одна открытая ставка на пару (ставящий, цель). API: GET/POST
  /api/compendium/bets (обзор: газ, цели с линиями, открытые всех,
  моя история; отмены ставок НЕТ — поставил, терпи).
- `weekly.py` — «Итоги недели»: Вс 21:00 МСК (18:00 UTC) карточка
  week_recap — топ-3 по газу за неделю (QuestCompletion с Пн 00:00 МСК),
  винрейт (мин. 3 катки), «Граммар-наци недели» (прирост
  grammar_errors над users.grammar_wk_base; база срезается тут же
  ВСЕМ; миграция 0010 бэкфиллит базу — иначе первая карточка судила бы
  по счётчику за всю историю). Пустая неделя — молчим; пропущенное
  воскресенье не догоняем, misfire_grace 2ч — не дольше: за полночью
  МСК уже «новая» неделя. Отправитель — топ-газ участник, фолбэк
  создатель.
- `finale.py` — **финал сезона**: cron 1-го числа 12:00 МСК (09:00 UTC,
  misfire 20ч; полдень — зазор под parse-рецеки и ночные даунтаймы
  OpenDota), под общим `_JOB_LOCK` поллера + дополнительный прогон при
  КАЖДОМ старте сервера (джобстор in-memory — рестарт поверх крона иначе
  терял запуск; внутри гард «1-го числа до полудня МСК — рано»).
  Закрывает ВСЕ незакрытые прошлые сезоны (не только вчерашний): снапшот
  таблицы в season_results (идемпотентно — сезоны, уже имеющие строки,
  пропускаются; только gas>0; сортировка -gas, тай-брейк username),
  карточка `/quest_card kind=season_final` (season_name родительным —
  MONTHS_GEN, podium топ-3) во все compendium_enabled-группы + пуш.
  Отправитель карточки — лучший по месту УЧАСТНИК конкретного чата
  (фолбэк — создатель чата): чемпион может не состоять во всех группах.
  Цикл по чатам — снапшот id + перечитка Chat/User на итерацию, ошибка
  одного чата роллбэчится и не травит остальные (грабля №2). Награды НЕ
  в колонках — выводятся из season_results запросами. Совсем поздний
  парс (recheck до 36ч) может докапать газ в закрытый сезон — снапшот НЕ
  пересчитывается, это осознанно.
- `api/compendium.py` — /me (ротации+done, марафоны с прогрессом, анти done
  только текущего сезона, трофеи, cosmetics), /season (таблица привязанных),
  /user/{id} (чужая полка, desc у тайных «???»), PATCH /cosmetics
  (валидация по comp_max_level — уровню ЛУЧШЕГО сезона, см. bets.py:
  значок ур.2, титул ур.4 из заработанных, цвет ур.6 из NAME_PALETTE,
  рамка lime ур.8 / animated ур.12; золотой /dota ур.10 — авто). UNLOCKS/палитра — там же. **Финал**: рамки gold/silver/bronze
  валидируются МЕСТОМ 1/2/3 в любом сезоне (PODIUM_FRAME_PLACE, не
  уровнем), титулы «Чемпион <месяца>» (_champion_titles) дописываются в
  _earned_titles и носятся С ЛЮБОГО уровня (обход замка ур.4 — титул за
  место), podium_frames в cosmetics-ответах, GET /seasons — архив
  закрытых сезонов (до 12, роут ПЕРЕД /season).
- `app/opendota.py` — клиент: **строго IPv4** (`local_address="0.0.0.0"` —
  лечит зависший IPv6 VPS), таймауты connect=5/read=25, retries=2.
  resolve_link_input: /profiles/id64, /id/vanity (нужен STEAM_API_KEY),
  Dotabuff/OpenDota-ссылки, голый steamID64 или Friend ID. Лимит free:
  2000/день, 60/мин — при >20 привязанных поднять DOTA_POLL_MINUTES.
- Тизер: `server/assets/compendium/intro.mp4` (в репо, H.264+AAC) — lifespan
  копирует в uploads-том → `/uploads/compendium/intro.mp4`. Замена видео =
  замена файла в репо.
- Миграции `alembic/versions/`: 0001 базовая, 0002 push_tokens,
  0003 компендиум, 0004 косметика, 0005 BIGINT+unique на dota_account_id,
  0006 web_push_subscriptions, 0007 chats.is_notes + reminders,
  0008 season_results (unique season+user), 0009 bets,
  0010 users.dota_presence_visible + grammar_wk_base (бэкфилл),
  0011 пересчёт comp_max_level под «уровень лучшего сезона».
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
  своему), рамка/титул/значок косметики, админ-чистка сообщений; в СВОЁМ
  профиле — секция «МОБИЛЬНАЯ ВЕРСИЯ»: QR на `${BASE_URL}/apk` (зеркало
  свежего APK на нашем VPS; версия сборки подтягивается из GitHub API,
  404 = «сборка готовится») + QR на PWA `${BASE_URL}/app/`. QR всегда
  чёрный-на-белом в обеих темах.
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
веб-стабами (webrtc-стаб мапит на браузерный WebRTC — звонки в PWA работают).
Табы: ЧАТЫ / ГАНДОЛИУМ / Я. Экраны: chats/* (ChatScreen рендерит маркеры
карточек, PokerScreen), compendium/CompendiumScreen (полный: задания с
пулами, сезон, трофеи, косметика), profile/* (MyProfile — секция DOTA 2 с
привязкой Steam, DotaRankBadge). PWA-обвязка: public/manifest.webmanifest +
icon-192/512 + статические apple-теги инжектятся постбилдом в index.html
(scripts/postbuild-web.js) — НЕ полагаться на рантайм-инжект webPwa.ts.
sw.js без кэша (нарочно). Пуши: Expo (native) + **Web Push для PWA**
(services/webPush.ts: включение — кнопкой «Уведомления» в профиле, iOS
требует жест; на старте молчаливая переподписка). ws.ts: pong-надзор (3
безответных пинга → close → реконнект) + мгновенный реконнект на AppState
active/visibilitychange — иначе после разворота телефона сокет «полумёртв».
Звонки (CallContext.tsx + webrtc.ts, UI = модалка НАД навигатором): камера
по умолчанию ВЫКЛ (аудио-старт; enableCamera лениво берёт камеру и делает
addTrack+ренегосиацию через negotiationneeded, disableCamera глушит железо
через replaceTrack(null)+stop); «назад» СВОРАЧИВАЕТ звонок (мини-бар
сверху, тап=развернуть), НЕ кладёт трубку; RemoteTile рендерит RTCView
ВСЕГДА (в вебе это <video> с ЗВУКОМ — иначе собеседник без камеры нем в
PWA), аватар — оверлеем; дорожки без потока (десктопный transceiver без
msid) докладываются в remoteStreams-карту — без этого вебка с компа не
появлялась; webrtc.init перевешивает WS-хендлеры каждый раз (логаут
стирает их — иначе после перелогина звонки мертвы); звонит только на
offer + членство в activeCalls-реестре (сброс на _ws_open); входящий
гаснет сам через 20с (локально, deps по chatId — подгрузка имени не
рестартует таймер/звук); рингтон мягкий «как на компе» — сигнал/5с + один
импульс вибрации, volume 0.6; activeCalls (chat_id→[user_id]) в
CallContext по call_active (дедуп по составу), в ChatScreen плашка
«В созвоне: имена» (тап/кнопка = joinOngoing → call_join; свой звонок =
развернуть). joinOngoing/joinCall флашат очередь накопленных сигналов
(_flushPending — иначе оффер звонившего завис бы навсегда) + сторожок
12с на мёртвый join; startCall защищён от повторного входа при свёрнутом
звонке (иначе утечка микрофона). RTCView в RemoteTile С KEY ПО
ВИДЕОДОРОЖКЕ — натив привязывает дорожку один раз при streamURL, без
ремаунта поздняя камера = чёрная плитка. `signal.renegotiate` от
десктопного респондера → добавить recvonly-видеотранссивер + оффер
(иначе его вебка не доедет в звонке, начатом с телефона). Мини-бар
свёрнутого звонка — В ПОТОКЕ над навигатором (сдвигает приложение вниз;
оверлей накрывал шапки экранов наглухо).
«Заметки»: кнопка 📝 в списке чатов → notesApi.open → ChatScreen с
isNotes (⏰-шторка: пресеты + сегодня/завтра + ЧЧ:ММ, БЕЗ нативных
пикеров; карточка /reminder с отменой; локальные уведомления через
services/reminders.ts + ресинк после логина). Камера в звонке:
switchCamera (натив track._switchCamera, веб — реаквизиция по facingMode
+ replaceTrack), кнопка 🔄 видна при включённой камере, mirror только у
фронталки. Имя ЛС-чата без собеседника (Заметки) — ветка is_notes в
useChats/getChatName, иначе показывался бы сам юзер.
Голосовые (ChatScreen + VoiceMessage): перед записью выгружаются ВСЕ
живые плееры голосовых (unloadAllVoicePlayers — живой Sound держит
аудио-сессию на части андроидов), ретрай prepare — только со СВЕЖИМ
объектом Recording (упавший prepare портит объект навсегда — ловили
«одно голосовое за запуск»), busy-флаг со сторожком 6с. Кнопка 📝
Заметок показывает ошибку вместо молчания (404 = «сервер не обновлён»).
Версия своя (0.7.x, app.json+package.json).

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
10. **Мобильный /me при старте**: сетевые/5xx ошибки НЕ разлогинивают —
    токен выкидывается только на 401/403 (AuthContext). Иначе PWA с ярлыка
    разлогинивала людей при секундном отсутствии сети («не могу зайти»).
11. **OTA не пересекает версию**: runtimeVersion=appVersion, поэтому
    eas update долетает только до приложений ТОЙ ЖЕ version. Бамп version
    в app.json = всем нужен новый APK (QR в профиле), OTA до старых больше
    не дойдут. Внутри одной version JS-правки едут по воздуху сами
    (workflow Mobile OTA на пуш в main).
12. **GitHub-CDN душится у RU-провайдеров**: прямое скачивание release-
    ассетов виснет на ~100% («загрузка не завершена»). Большие файлы для
    людей раздаём со СВОЕГО VPS (`/apk`, app/apk_mirror.py), GitHub — только
    как источник для зеркала и фолбэк.

## Бэклог (одобрено хозяином, порядок согласован)

1. Опросы в чатах — С ВОЗМОЖНОСТЬЮ вписывать свои варианты (требование
   хозяина); закреплённые сообщения в группах.
2. Релиз мобилки 0.8 (новый APK, versionCode 8): динамик/громкая связь +
   персональная громкость участников (нативный модуль).
3. Адаптивность PWA на широких экранах (два столбца, как договорились).
4. Хвосты звонков: ретраи сигналинга/ICE-restart на мобилке, приём шеринга
   экрана на телефоне; самсунг ANR/нагрев — наблюдать после камеры-офф.

ОТКЛОНЕНО хозяином: «страховка от дна» (сжечь газ и стереть анти-ачивку) —
анти-ачивки ВЕЧНЫЕ, «пусть будут напоминанием» :)
