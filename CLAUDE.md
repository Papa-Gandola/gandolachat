# GandolaChat — карта проекта (для Клода)

Discord-подобный мессенджер для чата друзей. Расчётная ёмкость ~50 человек —
это ЗАПАС хозяина на друзей/родственников; реально активных 9–10 (слова
хозяина, 17.09): лимиты OpenDota/пушей/покера считать от этой цифры, но
масштабирование до ~50 не ломать. Личный проект Гандолы (Papa-Gandola). Общение — по-русски; хозяин на Windows 11, знает Java/Python.
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
| `mobile/` | PWA: на VPS `cd mobile && npm run build:web` → скопировать `mobile/dist/*` в `server/web/` (bind-mount, рестарт не нужен; Node 20 на VPS стоит). Скрипт `postbuild-web.js` префиксует пути `/app`. Нативный Android: изменение mobile/app.json\|package.json\|eas.json в main (или тег `mobile-v*`) → Actions ждёт сборку EAS и сам публикует APK в скользящий релиз **mobile-latest** — постоянная ссылка `releases/download/mobile-latest/gandolachat.apk` (на неё смотрит QR в профиле десктопа). При новом APK поднимать И version, И versionCode (appVersionSource: local), а при НАТИВНОМ изменении — ещё и runtimeVersion (грабля №11). Версия mobile своя (0.9.x). **Тестовая сборка с ветки БЕЗ публикации**: Actions → Mobile Release → Run workflow → ветка, publish=false → APK артефактом прогона + прямая ссылка EAS в сводке; так хозяин проверяет натив на телефоне ДО мержа (merge в main = публикация в mobile-latest, куда смотрит «обнови меня» у всех). При заметном батче правок поднять `CHANGELOG_ID` (дата) в `mobile/src/changelog.ts` + дописать пункты — мобильное «Что нового» (версия для OTA не годится, она не меняется) |
| только docs | ничего |

Ошибся тегом: удалить И черновик релиза на GitHub, И тег
(`git tag -d vX && git push origin :refs/tags/vX`), потом заново.

## Сервер (`server/`, FastAPI + SQLAlchemy 2.0 async + PostgreSQL)

Запуск: `uvicorn app.main:app`. В Dockerfile PYTHONUNBUFFERED=1 — иначе
print-логи видны в `docker compose logs` с опозданием (не убирать).
В lifespan: alembic upgrade → синк
`assets/compendium/intro.mp4` в uploads → APScheduler-джобы.

- `app/main.py` — app, CORS, статика `/app` (PWA), WS-роут
  `/ws?token=`, джобы: cleanup_expired_messages (удаляет ТОЛЬКО сообщения с
  выставленным expires_at — обычные ВЕЧНЫЕ), поллер компендиума.
  `/uploads` — НЕ StaticFiles, а `app/uploads_static.py`: starlette 0.37
  (прибит fastapi 0.111) на Range отвечает 200 целиком, Chromium тогда не
  даёт перематывать <audio> и качает m4a целиком ради moov в хвосте.
  Своя ручка: 206 + Content-Range на одиночный диапазон (в т.ч. суффикс
  `bytes=-N`), 416, HEAD, Accept-Ranges всегда, защита от `..`. nginx на
  VPS Range сам не подкладывает (proxy_force_ranges выключен) — поэтому
  у себя, а не в конфиге, которого нет в репо.
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
  delete, messages (limit/before_id), search, файлы (+caption,
  media_group_id для мозаики): **лимит на файл — видео (`VIDEO_EXTS`
  mp4/mov/m4v/webm/mkv/3gp или content-type video/*) до MAX_FILE_SIZE_MB=50,
  остальное 10 МБ**; запись потоком кусками по 1 МБ, перебор → 400 «Файл
  больше N МБ» и файл удаляется. nginx на VPS должен пускать столько же
  (`client_max_body_size` ≥ 50m) — конфига в репо нет, при 413 смотреть
  туда. Пуш на файловое сообщение — с 18.09 (`_file_preview`: 🎤/🖼/🎬/📎
  + подпись), тот же троттлинг 15с/чат, что у текста (пачка фото = один
  пуш); раньше файлы пуш не слали вовсе.
  read-status, unread counts, online,
  stats, админ-чистка сообщений до даты. Caption с `/quest_card` режется.
- Пуш-данные message/call несут chat_name; для ЛС (chat.name=NULL) —
  имя отправителя/звонящего, иначе тап по пушу открывал чат «Чат».
  `message_read` бродкастится ВСЕМ сокетам чата (БЕЗ exclude_user!),
  включая другие устройства читателя — клиенты гасят по нему свой unread
  (кросс-девайс прочитанность: Sidebar на десктопе, useChats на мобилке).
  `exclude_user` в broadcast_to_chat вырезает ВСЕ сокеты юзера, а не
  только приславший — с ним кросс-рид молча не работал (2.3.8→2.3.9).
- `app/ws/manager.py` — ConnectionManager: мультисокеты на юзера,
  chat_users, active_calls + call_meta (для /call_record), broadcast_to_chat
  (_eid дедуп), send_to_user, дроп мёртвых сокетов. **Состав звонка — по
  user_id, но с привязкой к СОКЕТУ** (`call_sockets: chat → user → сокеты`,
  методы join_call/leave_call/end_call/drop_call_socket): mesh ключуется
  юзером, а вот выходить из звонка обязано УСТРОЙСТВО. Раньше чистка жила
  под `if fully_offline` — пока у юзера оставался хоть один сокет, умерший
  телефон висел в составе до конца звонка: на компе вечное «вы в звонке с
  другого устройства», и там же глохли входящие по этому чату (подавление
  «я уже в этом звонке» смотрит в тот же реестр). Теперь дисконнект любого
  сокета выводит юзера из звонков этого сокета и рассылает call_end +
  call_active (плюс адресный call_end своим же другим устройствам).
  Тест: scratchpad `test_call_roster.py` (TestClient, два сокета одного
  юзера, обрыв телефона).
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
  `GET /apk/info` — имя релиза/дата/размер из meta.json (404 пока зеркала
  нет): подпись под QR в профиле десктопа берёт ЕЁ, а не api.github.com
  с компа каждого человека (грабля №12 — у части людей строчка молча не
  появлялась). Плюс `version`/`build`, распарсенные из имени релиза
  «GandolaChat Android 0.8.0 (сборка 8)» (`_parse_release_name`; Actions
  называет релиз так — менять формат = сломать сравнение) — по `build`
  мобилка (`components/UpdateNagModal.tsx`) сравнивает свой
  `Constants.nativeBuildVersion` и просит обновиться: окно «Обнови меня до
  x.x.x» с кнопкой «Скачать APK» (→ `/apk`) раз в 3 захода (1-й, 4-й,
  7-й…; счётчик в secureStorage на каждую сборку зеркала свой; заход =
  холодный старт или возврат из фона после ≥2ч; пока не закрыто «Что
  нового» — молчит; в PWA не показывается).
- `app/backups.py` — ночные дампы БД: 04:00 МСК `pg_dump -Fc` в
  ОТДЕЛЬНЫЙ том `backups:/app/backups` (НЕ uploads — тот публичен!),
  ротация 14 шт. **Офсайт**: при заданных BACKUP_WEBDAV_URL/USER/
  PASSWORD (compose из .env или server/.env) свежий дамп улетает PUT-ом
  на любой WebDAV + удалённая ротация KEEP через PROPFIND; httpx IPv4,
  ошибка выгрузки не роняет локальный бэкап. Приёмник — НЕроссийский
  (решение хозяина): Koofr app.koofr.net/dav/Koofr + app-пароль (логин —
  почта, папку создаёт MKCOL). pg_dump-16 в Dockerfile КОПИРУЕТСЯ из
  образа **postgres:16-bookworm** (multi-stage + ldd-сбор библиотек БЕЗ
  libc, обёртки с LD_LIBRARY_PATH в /usr/local/bin) — PGDG из РФ шаток, а
  главное плавающий python:3.12-slim уехал на trixie и bookworm-PGDG стал
  неразрешим (exit 100). ОБЕ стадии прибиты к bookworm и меняются только
  ПАРОЙ: плавающий `postgres:16` тоже уехал на trixie, и его pg_dump
  (glibc 2.41) молча падал на bookworm-базе (2.36) с «GLIBC_2.38 not
  found» — бэкапы не делались сутками, никто не знал. Страховки: `RUN
  pg_dump --version` в сборке (образ не соберётся с битым бинарником) и
  `backups.log_health()` в lifespan — печатает возраст свежего дампа в
  лог при старте («дампов нет» / «← СТАРЫЙ»).
  Достать: `docker compose cp
  server:/app/backups/<файл> ./`; восстановить: pg_restore --clean
  --if-exists -h db -U gandola -d gandolachat (затирает базу!).
  **Вложения — офсайт инкрементально** (18.09, `run_uploads_backup`,
  cron 01:20 UTC = 04:20 МСК, после дампа): каждый файл из
  `uploads/<каталог>/` (files, avatars, group_avatars, vapid; apk и
  compendium пропускаются) → `<BACKUP_WEBDAV_URL>/uploads/<каталог>/`;
  сверка по PROPFIND (имя+размер), удалённое НЕ удаляем (архив), файл
  читается целиком (≤50 МБ — chunked PUT не все WebDAV любят), после 5
  ошибок синк прекращается; состояние в `backups/uploads-sync.json`,
  `log_uploads_health()` при старте («ещё не синкались» / «← СТАРЫЙ»).
  Без BACKUP_WEBDAV_URL — no-op. Koofr бесплатный = 10 ГБ на дампы и
  вложения вместе — при 507/ошибках смотреть квоту. Восстановить:
  скачать `/uploads/*` с WebDAV в том uploads (тест: scratchpad
  `test_uploads_sync.py` со стабом WebDAV).
- `app/disk.py` — `log_health()` в lifespan: размер uploads (и отдельно
  вложений) + свободное место, пометка «МЕСТО КОНЧАЕТСЯ» при <2 GB —
  видео до 50 МБ на маленьком VPS, uploads никто не чистит; смотреть
  `docker compose logs server | grep disk` после деплоя.
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
  `populate_existing=True`, см. грабли №1). **Все мутирующие ручки читают
  стол через `_locked_table()` = `SELECT … FOR UPDATE`** (места — отдельным
  selectin, на них замок не нужен): без него ловили join × start (место
  после снапшота игры — энтри терялся навсегда), join × join (lost update
  котла), дабл-тап «Сесть» (два места, двойное списание), close × финал
  (котёл поверх возврата). Замок держится до commit — не делать под ним
  долгих внешних await'ов. Плюс ремень: `uq_poker_seat_user`
  (миграция 0015, дедуп перед созданием) — второй INSERT места →
  IntegrityError → 400, списание откатывается той же транзакцией.
  `_finish_tournament` тоже берёт FOR UPDATE и выходит без выплаты, если
  стола уже нет или `game_store.get(id) is not g` (закрыли/снесли во время
  последней раздачи); место, которого нет в игре, получает gas_paid назад;
  после коммита шлёт `poker_table_updated` со status=finished — клиенты
  гейтят «Сыграть ещё»/«Закрыть» по нему (и по `liveGame.finished` как
  фолбэк). Рост блайндов: ×1,5 с округлением к шагу по порядку величины
  текущего SB (`blind_step`: 10→5, 100→50, 1000→500), BB всегда 2×SB —
  жёсткие +50/+100 при SB=10 давали 10/20 → 60/120. Джоба `close_stale_tables`
  (раз в 30 мин) сносит столы старше 6ч — лобби по created_at, играющие
  от started_at (лобби собрали в обед, сели вечером — резать нельзя),
  finished не трогает — с `poker_table_removed` в чат (оба клиента его
  обрабатывают); «за газ» и не доиграно — сперва возврат gas_paid.
  **Настройки стола** (миграция 0013): создатель задаёт при создании и
  правит в лобби (PATCH /settings): стек, малый блайнд (большой = 2×),
  интервал роста, мест; `_apply_settings` валидирует (стек ≥ 5 BB и т.д.).
  Дефолты колонок применяются только при INSERT — свежему PokerTable поля
  заполняются явно перед `_apply_settings`. **Режим «за газ»**
  (`mode=gas`, `entry_gas`, `max_reentries`, `reentry_until_level`,
  `gas_pot`; у сидящего `gas_paid`/`reentries`): энтри списывается при
  посадке атомарно из профиля ТЕКУЩЕГО сезона (`bets.try_debit`, как
  эскроу ставок; не хватило — 400 и мимо), выход из лобби возвращает,
  смена режима/цены при ЛЮБЫХ сидящих — 400 (гард «только заплатившие»
  пускал chips→gas при сидящих бесплатниках — они играли бы за котёл
  даром; клиентский lockMoney = seats.length > 0). `max_seats` нельзя ужать
  ниже занятого seat_index (клиенты рисуют слоты 0..max_seats-1). Докупка POST /reentry:
  `poker_game.can_reenter` (вылетел, blind_level < окна, лимит) → списание
  → `reenter` (стартовый стек, в текущую раздачу не входит — start_hand
  сдаёт по stack>0); после списания перепроверка `g.finished` (гонка со
  сторожем → 409 + возврат). **Пауза докупки** (`REENTRY_GRACE_SECONDS`=30
  в ws/handler): фишки остались у одного, но есть `reentry_candidates` →
  турнир НЕ закрываем, `g.reentry_open_until`, `_grace_watch` ждёт
  дедлайн; докупка через API зовёт `resume_after_reentry` — продолжаем
  сразу. Без кандидатов (лимит/окно) — `_finish_tournament` сразу: котёл
  победителю `bets._credit` в текущий сезон + текст в чат
  (`post_chat_text`) + profile_updated. Закрытие/автозакрытие до финала
  возвращает всем gas_paid. **«Сыграть ещё»** POST /restart (создатель,
  finished): НОВЫЙ стол с теми же настройками и людьми (энтри заново;
  кому не хватило — пропущен, в чат строка), старый удаляется
  (`poker_table_removed` летит РАНЬШЕ ответа — клиенты ставят ответ
  поверх, не мержат). **История раздач** — в памяти GameState
  (`hand_log` → `history`, кэп 200): start_hand открывает запись (стеки на
  входе, блайнды), `_log_action` пишет `to` (сколько всего в круге),
  `_log_street` по улицам, `_finalize_log` из `_showdown`/
  `_award_uncalled_pot` (карты — только вскрытые); GET /history отдаёт
  свежие сверху + names; `history_len` в public_view — клиент с открытой
  панелью рефетчит по нему. Тесты: scratchpad `test_poker_gas.py`
  (вылет моделируется стеком 0 + `_finalize_log`, как настоящий шоудаун).
  Клиенты: форма настроек с пресетами (Быстрый/Обычный/Марафон), «⛽ За
  газ» с полями, % банка у рейза (рейз ДО current_bet + pct×(банк после
  колла), шаг 10), кнопки Докупиться/История/Сыграть ещё, баннеры паузы
  и финала, панель истории (десктоп — под шапкой, мобилка — Modal).
- `app/api/dota.py` — POST /call: сообщение `/dota_call` + пуш всем.
- `app/api/polls.py` — **опросы + закрепы** (миграция 0012: polls,
  poll_options, poll_votes, pinned_messages). Опрос: носитель — сообщение
  `/poll {id}`, создаётся ТОЛЬКО сервером в одной транзакции с опросом
  (спуф руками бесполезен: клиент сверяет poll.chat_id с чатом, иначе
  текст); POST /chats/{id}/polls (2..12 вариантов, дедуп, пуш как у
  сообщения с уважением троттлинга), GET /polls/{id}, /vote (ТОГГЛ:
  повторный клик снимает, одиночный выбор переезжает), /options
  (**дописывание своих вариантов — требование хозяина**; allow_add,
  дедуп, автор виден у дописанных), /close (автор или админ чата).
  WS `poll_updated` шлёт ПОЛНЫЙ PollOut; mine клиенты считают САМИ из
  options[].voter_ids (бродкаст с mine=false затирал галочку на втором
  девайсе, и клик там РАЗВОРАЧИВАЛ действие). Опрос в «канале»
  (allow_all_write=False) создаёт только создатель. vote/options/close —
  под with_for_update(Poll) + IntegrityError-ремень (гонки дабл-клика и
  двойного голоса в одиночном). close в ЛС — только автор (создатель
  ЛС-чата не «админ»). Пуш ЛС-опроса несёт peer_user_id (деп-линк).
  handle_delete_message при удалении закреплённого шлёт chat_pins.
  Закрепы: до 20 на чат, права в группе — создатель+admin_ids, в ЛС —
  оба (МОБИЛКА прав не знает — шлёт всегда, 403 показывает алертом);
  GET/POST /chats/{id}/pin(s), DELETE /pin/{mid}; WS `chat_pins` со всем
  списком. Клиенты: плашка над лентой (последний закреп, десктоп —
  выпадашка «ещё N», клик = скролл к сообщению), пункт в меню сообщения,
  кнопка 📊 в композере (десктоп) / «Опрос» в шторке скрепки (мобилка),
  карточка с прогресс-барами и «➕ Свой вариант».
- `app/steam_presence.py` — «🎮 в Доте сейчас»: джоба раз в 2 мин,
  GetPlayerSummaries батчами по 100 (IPv4-клиент opendota, грабля №3),
  in-memory набор, WS `dota_presence {playing}` при СМЕНЕ состава +
  снимок каждому новому сокету. Невидимка: users.dota_presence_visible
  (дефолт true, тумблер в профиле; PATCH /me гасит значок сразу через
  drop_user; перед публикацией опроса состав пересекается с актуальным
  visible-набором — гонка тумблера с летящим опросом). Ошибка Steam —
  состав НЕ трогаем (не мигать). Без STEAM_API_KEY джоба спит.
  ВТОРОЙ ИСТОЧНИК: десктоп детектит процесс dota2.exe (Electron main,
  tasklist раз в 30с, только win32) и шлёт WS dota_client_presence с
  хартбитом 60с — сервер держит отметку с TTL 180с (_client_until) и
  мержит со Steam-набором; работает при СТИМ-невидимке, наша невидимка
  уважается (проверка на set + drop_user чистит оба источника; prune
  протухших — в начале poll_presence, живёт и без STEAM_API_KEY).
  КЛИЕНТЫ: хендлер dota_presence перевешивается initPresence()/
  initDotaPresence() при каждом коннекте — логаут стирает ВСЕ
  WS-хендлеры (тот же класс бага, что чинили в webrtc.init); десктоп
  переотправляет клиентскую отметку на _ws_open.

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
- `prizes.py` — **приз чемпиону сезона** (миграция 0014: season_prizes —
  пул, season_prize_draws — снапшот на сезон, unique). Пул (title,
  hint1..3, weight 1..100, active) ведёт админ: GET/POST /prizes,
  PATCH/DELETE /prizes/{id} — все под `_require_admin`. Розыгрыш POST
  /prize/draw — ТОЛЬКО админ, один на сезон (unique + IntegrityError →
  400), взвешенный `random.Random(sha256(season:SECRET_KEY))` по активным
  — детерминирован, в draw снапшотятся название и подсказки (правка/
  удаление из пула потом ничего не меняют). Тизер GET /prize (все):
  drawn/revealed, `hints` — открытые по `HINT_DAYS=(8,15,22)` числам МСК
  (`hints_unlocked`; прошлый сезон — все), `next_hint_day`, после
  раскрытия title/winner, `last` — последний раскрытый ДРУГОГО сезона.
  Финал (`finale._finalize_one`) после снапшота таблицы зовёт
  `prizes.reveal(db, season, champion)` (идемпотентно), кладёт
  `payload["prize"]={title, winner}` в карточку season_final и в пуш;
  ошибка приза роллбэчится и финал не роняет; season_results при этом уже
  закоммичены и сезон в pending больше не попадёт — поэтому
  `_catch_up_prizes` в конце `finalize_season` раскрывает такие призы
  задним числом по чемпиону из season_results (без второй карточки;
  сезон без результатов не трогает). Финал закрывает ПРОШЛЫЙ
  месяц, когда текущий уже новый — поэтому раскрытый приз клиенты
  показывают строкой «🏆 <месяц>: «приз» — чемпион» из `last`, а
  `revealed` текущего сезона в проде почти не встречается. Дарит хозяин
  руками — приложение только выбирает и объявляет. Клиенты: десктоп
  `PrizePanel` в CompendiumPage (между шапкой и вкладками; «???» +
  подсказки + 🔒 следующая дата; админу — «🎲 Разыграть» с confirm и
  «Пул призов» — модалка `PrizePoolModal` со списком, весами и честными
  процентами шанса, формой добавить/править, тумблером вкл/выкл;
  перечитка по карточке season_final и в полночь МСК), мобилка —
  read-only блок в CompendiumScreen (виден только когда drawn или есть
  last; 404 старого сервера — блока нет). Строка приза — и в карточке
  season_final (ChatArea/ChatScreen). Тест: scratchpad `test_prizes.py`.
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
  0011 пересчёт comp_max_level под «уровень лучшего сезона»,
  0012 polls/poll_options/poll_votes/pinned_messages,
  0013 покер: настройки стола + режим «за газ» (poker_tables/poker_seats),
  0014 season_prizes + season_prize_draws (приз чемпиону),
  0015 uq_poker_seat_user (одно место на юзера за столом, с дедупом).
  Только добавления; прогоняются сами на старте.

## Клиент десктоп (`client/`, Electron + React + Vite)

- `src/main/main.ts|preload.ts` — frameless окно, IPC (minimize/maximize/
  hide/quit/openExternal). В браузере всё через `window.electron?.` гарды.
- `services/api.ts` — axios + ВСЕ типы. `BASE_URL = VITE_API_URL ||
  "https://2-26-117-77.sslip.io"` — https-фолбэк обязателен (v2.1.8 сломался
  пустым секретом). `services/ws.ts` — реконнект, ping/quality, МАССИВ
  хендлеров на тип (on/off). `services/markers.ts` — превью служебных
  маркеров (сайдбар + уведомления) + `filePreview(name)` для файловых
  сообщений («🎤 Голосовое» для voice_*.m4a, «🖼 Фото», «🎬 Видео»). `services/theme.ts` — темы "discord" |
  "neo" (класс на body + CSS-переменные; neo с кастомными bg/accent из
  localStorage). Всё стилится через var(--*), у neo — mono-шрифт и нулевые
  радиусы (`isNeo` ветки в каждом компоненте).
- **Единый стиль «Б»** (2.3.11, выбор хозяина): (А) кнопки и служебные
  значки — ТОЛЬКО линейные иконки `components/icons.ts` (пути, одна
  иконка = одна строка) + `Icon.tsx` (`<Icon name size strokeWidth>`,
  currentColor, 24×24/1.75; `<Gas>` = фирменный ⛽ — ЭМОДЗИ через шрифт
  Twemoji, НЕ линейная иконка: линейную колонку (ушла в релиз 2.3.11)
  хозяин попросил вернуть назад на второй день, «⛽ нравился всем» —
  вернули в 2.3.12, не менять);
  системных эмодзи-кнопок больше нет и новых не заводить — добавляй
  путь в icons.ts. Превью маркеров/файлов в сайдбаре и закрепах: ведущий
  значок строки → иконка через `PREVIEW_ICONS`/`splitPreviewIcon`
  (markers.ts) + `<PreviewText>`; строки самих превью НЕ трогать — они же
  уходят в системные уведомления. Контентные эмодзи (🏆 🥇 💀 🎁 в
  карточках, реакции, пикер) остаются символами. (Б) их рисует встроенный
  шрифт **`assets/fonts/TwemojiGandola.ttf`** — COLRv1, собран
  `client/scripts/build-twemoji-font.py` из @twemoji/svg 15 через
  nanoemoji (+ cmap14 для FE0F и лигатуры без FE0F — без них Chromium
  разрывал ZWJ-цепочки типа 🏳️‍🌈 и ❤️‍🔥; HarfBuzz сам собирал, Blink нет).
  В global.css ДВЕ @font-face на один файл: «Twemoji Gandola» в общих
  стеках --font-sans/--font-mono ограничен unicode-range на
  Emoji_Presentation + компоненты (чтобы ♠♥♦♣ покерных карт, ✓ ▶ ⚠ ↩
  оставались текстом), «Twemoji Gandola Any» без ограничений — классом
  `.emoji` на распознанные последовательности (`Emoji.tsx`: EMOJI_RE по
  \p{Emoji_Presentation}/\p{Extended_Pictographic}+FE0F/тон кожи/ZWJ/
  флаги/кейкапы; `<EmojiText>` в FormattedText и превью, `<Emoji>` в
  реакциях и пикере). Иначе ❤️ (2764 FE0F — текстовый знак + селектор)
  ушёл бы в Segoe. Мобилка/PWA — системные эмодзи (не трогали).
- `pages/Main.tsx` — тайтлбар с меню режимов **chat / compendium**
  (localStorage "gandola-mode"; сохранённый «poker» старых версий = chat),
  версия приложения в шапке, WS-подписки, входящие звонки, роутинг
  Профиль/Инфо группы/Покер/Гандолиум/Чат. Клик по чату/уведомлению и
  Escape выводят из Гандолиума. **Покер — НЕ режим** (2.3.13; раньше был
  липкий глобальный режим с тем же сайдбаром, и люди «проваливались» в
  столы вместо переписки — жалоба хозяина 17.09): `pokerChats:
  Set<chatId>` на сессию (не persisted) — в каких чатах вместо переписки
  открыты столы; открывают кнопка «Столы» в шапке ChatArea
  (`onOpenPoker`), карточка `/poker_table` (событие `open-poker-table` →
  активный чат + столы, Poker сам выбирает стол по tableId) и легаси
  `set-app-mode {mode:"poker"}`; закрывают «← В чат»/«В чат»
  (`Poker.onBackToChat`) и Escape (не сбрасывая чат). Клик по чату в
  сайдбаре открывает переписку, если в этом чате столы не открывали в
  этой сессии; после перезапуска — везде переписка. **Стол + переписка**
  (2.3.14): справа от Poker колонка 380px с `<ChatArea compact>` того же
  чата (шапка без кнопок), тумблер «Переписка» в шапке стола
  (`chatColumn`/`onToggleChatColumn`, localStorage
  `gandola-poker-chat-column`, дефолт вкл). **Значок стола в сайдбаре**:
  `pokerApi.active()` → `GET /api/poker/active` ({chat_id: lobby|playing}
  по чатам юзера) при коннекте + рефетч на любой `poker_table_*`; иконка
  `cards` у имени чата (оранжевая = играют). **«Перейти сюда»** (2.3.15) в
  плашке созвона, когда состав содержит нас самих: вторым входом тем же
  user_id войти нельзя (mesh ключуется юзером), поэтому `takeOverCall`
  сперва шлёт `call_end` (сервер выкидывает юзера из состава и кладёт
  трубку на том устройстве), ждёт состав без себя до 3с и зовёт
  `joinOngoingCall`. Пустой состав = звонок кончился, входить некуда.
- `ChatArea.tsx` (большой) — переписка: маркеры контента → карточки:
  `/poker_table N`, `/dota_call` (ready-лист по WS, запуск
  `steam://rungameid/570`, золотая при comp_max_level≥10 отправителя),
  `/quest_card {json}` (QuestCardMsg: цвета рассчитаны на 4 комбинации
  тема×своё/чужое — своё сообщение = цветной пузырь!), `/call_record ...`.
  Реакции, реплаи, эдит (execCommand-форматирование), пересылка, поиск,
  мозаика медиагрупп, уведомления с markerPreview, цвет ника+⛽ из
  косметики (по chat.members). Аудио-вложения (voice_*.m4a с телефона и
  любое аудио по расширению; webm нарочно нет — с телефона это видео) —
  `VoicePlayer.tsx`: play/pause, перемотка, 1×/1,5×/2×, одно играет разом,
  цвета через currentColor пузыря (обе темы, свой/чужой без своей
  палитры), duration=Infinity у стримящегося m4a → «–:––» до честного
  значения. **Видео** (mp4/mov/m4v/webm/mkv/3gp, `isVideo`) —
  `VideoPlayer.tsx`: штатный `<video controls preload=metadata>` в пузыре,
  ≤420×320 по реальному соотношению сторон (вертикальные — по высоте),
  одно играет разом, ошибка → ссылка «открыть»; у ожидающего вложения
  превью — первый кадр `<video muted>`; клиентский лимит 50 МБ видео /
  10 МБ прочее (как на сервере). Тайные ачивки (`cat==="secret"` у items) — золотые: рамка,
  🔓, заголовок «ТАЙНОЕ ОТКРЫТО», когда все пункты тайные; в полках
  Гандолиума (трофеи + чипы чужих) — золотые целиком (фон/рамка/свечение/
  метка «ТАЙНОЕ»), на мобилке то же.
- `CompendiumPage.tsx` — тизер-оверлей (каждый вход, loop, чек-бокс
  «отключить заставку» = localStorage gandolium.introOff, по умолчанию
  показывается), шапка уровня/газа, вкладки ЗАДАНИЯ/СЕЗОН/ТРОФЕИ/КОСМЕТИКА,
  обновление по WS `/quest_card` и в полночь МСК, клик по вкладке = рефетч,
  ошибка сезона ≠ «никто не привязал».
- `ProfilePage.tsx` — профиль+редакт, секция DOTA 2 (привязка/обновить/
  отвязать, бейдж звания, подсказка про «общедоступную статистику» только
  своему), рамка/титул/значок косметики, админ-чистка сообщений; в СВОЁМ
  профиле — секция «МОБИЛЬНАЯ ВЕРСИЯ»: QR на `${BASE_URL}/apk` (зеркало
  свежего APK на нашем VPS; подпись «релиз · дата · размер» — с
  `${BASE_URL}/apk/info`, 404 = «сборка готовится», сетевой сбой тоже
  показывается, а не молчит) + QR на PWA `${BASE_URL}/app/`. QR всегда
  чёрный-на-белом в обеих темах.
- `DotaRankBadge.tsx` (медали Рекрут…Титан, tier=rank_tier//10, звёзды %10),
  `cosmetics.tsx` (nameColor/CompBadge/CompTitle/frameStyle; анимированная
  рамка — класс comp-frame-animated в global.css), `PokerAssistPanel.tsx` +
  `pokerAssist.ts` (шпаргалка комбинаций + pot odds/ауты 4-2, чистая логика
  с юнит-тестами), `Poker.tsx`, `VideoCall.tsx` (mesh ≤7, шаринг экрана;
  `services/webrtc.ts` открывает screen-peer и ОПОЗДАВШЕМУ участнику —
  при создании webcam-peer'а, если `localScreenStream` активен).
  **Висяки прозвона** (17.09, «не всегда получается зайти через
  Присоединиться»): `peerMeta {initiator, remoteSdp}` на webcam-peer;
  наш инициаторский peer без SDP той стороны через 5с после call_active с
  этим юзером пересобирается по tie-break'у (при обычном приёме ансвер
  приходит СРАЗУ за call_active — сервер шлёт состав ДО пересылки сигнала);
  чужой оффер в наш неотвеченный оффер → уступаем responder'ом; ансвер/
  кандидат без peer'а — дроп (responder под них блокировал tie-break);
  pending-сигналы несут chat_id — `discardPending` на «Отклонить» и на
  пустой call_active, flush применяет ТОЛЬКО сигналы текущего чата и
  только если среди них есть оффер; close/error СТАРОГО peer'а
  игнорируются, если слот уже занят новым (simple-peer шлёт close
  микротаской ПОСЛЕ map.set — раньше удалял НОВЫЙ peer и играл отбой),
  пересборка помечена `silentPeers`; при пересборке webcam-peer'а сносится
  и наш screen-peer к этому юзеру (иначе гард «уже есть» не открыл бы ему
  свежий, и опоздавший не видел экрана). **Смена микрофона** —
  `switchMicrophone`: «По умолчанию» = audio:true, виртуальные id
  default/communications в списке нет и не запрашиваются (на Windows после
  смены устройства «default» давал немой трек), новый трек ждём
  live/unmute до 4с и только потом гасим старый (неудача — остаёмся на
  прежнем + строка ошибки), мьют переносится, `micEpoch` перезапускает
  анализатор «говорю» (MediaStreamSource привязан к дорожке на момент
  создания — после replaceTrack ободок гас навсегда), список устройств
  обновляется по devicechange; выдернули выбранный микрофон → сами
  переходим на «По умолчанию» (иначе контролируемый select показывал
  его, а дорожка была мертва и повторный выбор onChange не давал).
  Остальное:
  `Sidebar.tsx` (чаты, поиск, создание, unread, превью маркеров, настройки
  тем, admin-заявки), `MemberList.tsx`, `GroupInfoPage.tsx` (описание,
  админы, тумблер Гандолиума), `FormattedText.tsx` (маркдаун+спойлеры).
- **Typecheck**: `npx tsc -p tsconfig.json` шумит предсуществующим
  `import.meta.env`/VideoCall — НЕ чинить, фильтровать. Правда — `npx vite
  build`. Сборка релиза: `npm run dist` (electron-builder, releaseType
  draft).

## Мобилка/PWA (`mobile/`, Expo SDK 57 + RN 0.86, новая архитектура)

Один код на Android-натив и веб-PWA (iPhone: Добавить на экран «Домой» с
`https://…/app/`). metro.config подменяет нативные модули (webrtc, notifee,
incall-manager, expo-media-library) веб-стабами (webrtc-стаб мапит на
браузерный WebRTC — звонки в PWA работают; media-library-стаб — потому что
с SDK 54+ его индекс на вебе требует нативный модуль ПРИ ИМПОРТЕ, и PWA
падала белым экраном ещё до логина; «Сохранить» фото в PWA = открыть в
новой вкладке).
**Стек 0.9.0 (SDK 57, 18.09)**: RN 0.86 — ТОЛЬКО новая архитектура (legacy
снята в RN 0.82), edge-to-edge принудительно; React 19; expo-av УДАЛЁН —
звук через **expo-audio** (`services/voiceRecorder.ts`: рекордер создаём
ИМПЕРАТИВНО, свежий объект на каждую запись — хук useAudioRecorder даёт
один на экран, а упавший prepare делает объект одноразовым; конструктору
нужны ПЛОСКИЕ опции платформы, раскладываем пресет сами; `VoiceMessage` —
`createAudioPlayer` по тапу + `playbackStatusUpdate`, после `didJustFinish`
перед play обязателен `seekTo(0)`; рингтон в CallContext — тот же плеер,
`seekTo(0)+play` раз в 5с), видео через **expo-video** (`VideoMessage`:
`useVideoPlayer` в дочернем компоненте, монтируется по тапу,
`surfaceType="textureView"` — SurfaceView не режется скруглением пузыря,
соотношение сторон из `sourceLoad`/`videoTrack`; в вебе дорожек нет — 16:9
contain). expo-file-system — новый API (`File`/`Paths`;
`File.downloadFileAsync` не перезаписывает — старую копию удалять).
react-navigation 7: `navigate` больше НЕ возвращается к экрану глубже в
стеке (только к текущему) — в `navigationRef.navigateToChat` и
`ChatsSidebar` вложенные params несут `pop: true`, поиск по сообщениям
ходит `navigation.popTo(...)` (иначе Chat пушился поверх Chat); тема
контейнера обязана содержать `fonts` (берём из DarkTheme); форма
`navigate({name, params})` deprecated — `navigate("Main", {...})`.
**Загрузка файлов — ТОЛЬКО XMLHttpRequest** (`api.ts uploadFile`): с SDK 54+
глобальный `fetch` подменён своим (`expo/winter`, `install('fetch', …)`), а он
понимает лишь строки, Blob и File — RN-часть `{uri, name, type}` отвергает
с «Unsupported FormDataPart implementation» (так в 0.9.0 отвалились
голосовые) и вдобавок собирает всё тело в памяти JS. XHR у RN свой,
нативный NetworkingModule стримит файл с диска; `FormData` Expo только
дополняет (append/entries поверх `_parts`), `getParts()` цел. Не
«упрощать» обратно на fetch.
Типы react-native-webrtc 124.0.8 в пакете битые (lib/typescript ссылается
на vendor/event-target-shim, которого там нет — tsc «не видит»
addEventListener): `scripts/patch-webrtc-types.js` в postinstall
докладывает d.ts из src (только для tsc, сборке всё равно). `npx expo
install` здесь НЕ работает (api.expo.dev закрыт прокси, «Host not i…») —
матрицу версий берём из `npm pack expo@57` → `bundledNativeModules.json`.
Табы: ЧАТЫ / ГАНДОЛИУМ / Я. Экраны: chats/* (ChatScreen рендерит маркеры
карточек, PokerScreen), compendium/CompendiumScreen (полный: задания с
пулами, сезон, трофеи, косметика), profile/* (MyProfile — секция DOTA 2 с
привязкой Steam, DotaRankBadge). **Широкий экран** (`useIsWide`, ≥900px:
PWA в браузере на компе, планшет в ландшафте): `MainTabs` рисует ряд —
слева `navigation/ChatsSidebar` (постоянный список чатов, ходит по
навигации через `navigationRef` как тап по пушу, подсвечивает открытый
чат по текущему маршруту), справа табы. Список вынесен в
`screens/chats/ChatsListPane` (телефон использует его как экран
ChatsList; на широком ChatsList — заглушка «выбери чат слева», корень
стека для «назад»). Обёртка одна в обоих режимах, колонка — первый
ребёнок с ключом: смена ширины НЕ перемонтирует навигатор (проверено
Playwright: ресайз 1280→400 сохраняет открытый чат). Локальная прогонка
PWA: сид `scratchpad/seed_pwa.py`, uvicorn на 8000 + симлинк
`server/web → mobile/dist` (не коммитить), `scratchpad/pw/shot_pwa.js`
(playwright из глобальных модулей: `NODE_PATH=$(npm root -g)`). PWA-обвязка: public/manifest.webmanifest +
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
только В ВЕБЕ (там это <video> с ЗВУКОМ — иначе собеседник без камеры нем
в PWA); на НАТИВЕ при выключенном видео вьюху не держим: RTCView —
SurfaceView, он рисуется ПОВЕРХ обычных вьюх, и аватарка-оверлей не
перекрывала застывший последний кадр («выключил камеру на компе — на
телефоне стоп-кадр»), аватар — оверлеем; дорожки без потока (десктопный transceiver без
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
**Живучесть звонка** (16.09, webrtc.ts): раньше ICE `failed` = участник
выкинут навсегда — смена сети (Wi-Fi ↔ LTE, VPN) на любой стороне убивала
звонок. Теперь роли из tie-break'а: `initiators` — кто офферил, тот и
рестартит ICE (как simple-peer на десктопе; респондер ждёт чужой оффер).
`disconnected` → через 2с оффер с `iceRestart: true` (если не ожило
само), `failed` → рестарт сразу + сторож `_armFailWatch` (20с инициатор /
30с респондер, чтобы не офферить навстречу) → `_createPeer(uid, true)`
свежим оффером в ЛЮБОЙ роли: десктопный simple-peer на failed сам себя
уничтожает и пару не восстанавливает, а новый оффер принимает как обычный
входящий (createIfMissing). Оффер на наш «мёртвый» (failed) peer тоже
принимаем свежим соединением. Глейр: респондер откатывает свой оффер
(`rollback`), инициатор чужой отбрасывает. Сигналы одного собеседника
применяются строго по очереди (`chains` — кандидат после нового оффера
иначе ложился на старое описание). `have-local-offer` при восстановлении
= ответ потерялся → оффер шлём ещё раз. **Исходящие сигналы при закрытом
сокете** — в `outbox` (≤60), доотправка на `_ws_open` + `recover()`;
`recover()` зовётся и на AppState active (CallContext). **Висяк прозвона**
(17.09): в `_onCallActive` наш инициаторский peer без remoteDescription
через 5с пересобирается по tie-break'у (`staleTimers`, чистятся в
`_clearTimers`); глейр решает tie-break (меньший id — инициатор), а НЕ
роль прозвона — иначе позвонивший с телефона отбрасывал оффер вошедшего
позже десктопа с меньшим id; ансвер/кандидат без peer'а — дроп;
`pending`/`pendingScreen` несут chat_id: `discardPending(chatId)` на
«Отклонить» (CallContext.reject) и на пустой call_active (60с-таймаут
приходит ТОЛЬКО так, без call_end), `_flushPending` берёт только сигналы
текущего чата и только с оффером (иначе после «Отклонить» отвечали
мёртвому офферу и блокировали tie-break, а чужой чат получал фантомный
входящий). **Приём
экрана с десктопа**: десктоп шарит ОТДЕЛЬНЫМ simple-peer'ом на каждого
(`purpose: "screen"`, сам инициатор, `role: "sender"`); мобилка держит
`screenPeers` (только приём), отвечает с `role: "receiver"` (десктоп так
маршрутизирует ответ в свой отправляющий peer), `screen_share_status
{sharing:false}` и call_end гасят плитку сразу; `pendingScreen` — экран,
начатый пока мы ещё «звонили». UI (CallContext): `screens` +
`ScreenTiles` сверху (objectFit contain, key по видеодорожке), тап —
`screenFocus`: экран на всё, участники в полосу 104px (НЕ размонтируем —
в вебе через их RTCView играет звук). **Видео-линия ЕСТЬ ВСЕГДА**:
`_createPeer` при выключенной камере сразу заводит
`addTransceiver("video", {direction:"sendrecv"})` и кладёт его sender в
`videoSenders` — как десктоп. Без неё в согласованном SDP видео нет
вовсе, и включённая позже камера ЛЮБОЙ стороны требует ренегосиации,
которую отвечающая сторона начать не может (m-line добавляет только
офферящий) — отсюда «позвонил с компа без видео, телефон вошёл, включил
видео на компе — не видно». `enableCamera` после `replaceTrack`
дожимает `_renegotiate`, если `currentDirection` у слота всё ещё null.
**Экран С ТЕЛЕФОНА** (0.9.0):
кнопка «экран» в звонке (Android и PWA в десктопном браузере — где есть
getDisplayMedia; `canShareScreen`) → `webrtcService.startScreenShare`:
`mediaDevices.getDisplayMedia` (натив — `android.resolutionScale` 0.6:
полный 1080×2400×30fps на несколько кодировщиков mesh — перебор для
телефона) и ОТДЕЛЬНЫЙ RTCPeerConnection на каждого участника
(`screenSendPeers`, purpose=screen, role=sender, мы инициатор — зеркало
десктопа); ответы с role=receiver идут в `_applyScreenSendSignal`, а не в
приёмные screenPeers (один собеседник может одновременно показывать нам и
смотреть наш); опоздавшему участнику экранный peer открывается из
`_createPeer`; ICE рестартим сами (инициатор); `screen_share_status
{sharing}` шлём как десктоп; стоп из системной шторки / «Stop sharing» =
`ended` у дорожки → `onScreenShareEnded` гасит кнопку; teardown звонка
гасит шаринг первым (отпускает MediaProjection). НАТИВ (только новым APK):
Android 14+ пускает MediaProjection только процессу с РАБОТАЮЩИМ
foreground-сервисом типа mediaProjection, поднятым ПОСЛЕ согласия в
системном диалоге — rn-webrtc умеет это сам (свой `MediaProjectionService`
в манифесте библиотеки), но флаг по умолчанию выключен:
`plugins/withWebRTCMediaProjection.js` (а) вписывает
`WebRTCModuleOptions.getInstance().enableMediaProjectionService = true` в
MainApplication.onCreate, (б) кладёт `res/drawable/ic_notification.xml`
(bitmap-алиас на notification_icon от expo-notifications) — библиотека
ищет его по getIdentifier и НЕ поставляет, без него «Invalid notification
(no valid small icon)» = краш при первом же старте шаринга; разрешение
FOREGROUND_SERVICE_MEDIA_PROJECTION — в app.json. Сервис notifee остаётся
microphone|camera — тип mediaProjection ему не нужен.
ЗВУК в звонке (0.8, `services/callAudio.ts`): кнопка 🔊/🔈 — громкая связь
↔ разговорный динамик через **react-native-incall-manager** (нативный
модуль => только новым APK, не по OTA; в вебе metro-стаб + кнопка скрыта
по Platform). InCallManager.start ТОЛЬКО на активном звонке (на входящем
его IN_COMMUNICATION придушил бы наш рингтон), stop — в клинапе.
Персональная громкость участника — `track._setVolume(gain)` (0..10,
штатное API rn-webrtc, свой натив не нужен; в вебе метода нет — молча
пропускаем): тап по плитке раскрывает −/+ прямо в подписи, шкала
0/25/50/75/100/150/200/300%, не-100% видно в подписи и свёрнутой.
Применяется на КАЖДУЮ смену remotes (дорожка приезжает позже участника) и
сразу при клике, минуя ре-рендер. Оба параметра переживают перезапуск
(secureStorage, как мьют чатов); включение СВОЕЙ камеры уводит звук на
громкую связь, если человек не трогал кнопку в этом звонке.
«Выключить динамик» шлём НЕ как false: в библиотеке false → flag=-1 =
принудительный EARPIECE, и он выигрывает у Bluetooth/проводной гарнитуры
(наушники бы молчали). Не-boolean → flag=0 = маршрут по умолчанию —
хелпер `forceSpeaker`. Аудиосессия забирается при ПОДКЛЮЧЕНИИ участника,
а не по inCall: IN_COMMUNICATION глушил бы наш гудок/рингтон (expo-audio).
BLUETOOTH_CONNECT (Android 12+) в app.json + запрос в `ensurePermissions`
рядом с микрофоном ОБЯЗАТЕЛЕН: без него BT-менеджер библиотеки выходит на
старте и гарнитуры вообще нет в списке устройств. SCHEDULE_EXACT_ALARM/
USE_EXACT_ALARM — чтобы напоминания не уезжали в Doze (expo-notifications
сам падает на неточный setAndAllowWhileIdle, если разрешения нет).
В 0.8 заодно объявлены НА ВЫРОСТ (манифест правится только новым APK, а
код поверх них доедет по OTA): USE_FULL_SCREEN_INTENT — полноэкранный
входящий звонок поверх блокировки через notifee;
REQUEST_IGNORE_BATTERY_OPTIMIZATIONS — подсказка «отключи оптимизацию
батареи» для самсунгов, которые режут фоновые звонки и пуши.
Нативный батч 0.9.0 (SDK 57 + экран С телефона, runtimeVersion 9) —
сделан 18.09; всё объявленное для 0.8 в манифесте осталось.
**Фоновый сервис звонка** — ПОДТВЕРЖДЁННАЯ ПРИЧИНА «Гандола не отвечает»
в середине звонка. ANR-трейс с телефона хозяина: «A foreground service of
FOREGROUND_SERVICE_TYPE_SHORT_SERVICE did not stop within a timeout:
ComponentInfo{com.gandola.chat/app.notifee.core.ForegroundService}», при
этом main-поток стоял в обычном Looper'е — приложение НЕ висло вообще.
notifee объявляет свой сервис в манифесте как `shortService`, а у того
жёсткий лимит в несколько минут: разговор дольше — система бьёт ANR.
Лечится ДВУМЯ частями, обе обязательны:
(1) **манифест** — плагин `plugins/withCallForegroundServiceType.js`
переопределяет тип сервиса на `microphone|camera` (`tools:replace`, иначе
мержер падает на конфликте с библиотечным shortService). Это НЕ правится
по OTA — только новым APK;
(2) **рантайм** — `foregroundServiceTypes` в displayNotification:
MICROPHONE всегда, CAMERA только когда камера реально включена (тип
требует ВЫДАННОГО разрешения, в голосовом звонке его может не быть, а
notifee честно передаёт наши типы в трёхаргументный startForeground —
проверено по классам AAR). Манифест при этом объявляет надмножество.
Без типа camera система ещё и ОТБИРАЕТ камеру у свёрнутого приложения:
дорожка остаётся, кадров нет, у собеседника вечный стоп-кадр даже после
возврата (лечили ручным «выкл/вкл»).
Уведомление переобъявляется на каждый тумблер камеры ОТДЕЛЬНЫМ эффектом
(не stop/start сервиса). `registerCallForegroundRunner()` зовётся НА
УРОВНЕ МОДУЛЯ в App.tsx: система может поднять сервис раньше любого
компонента, и без обработчика он не успевает стартовать за 5с = ANR.
Страховка сверху: на возврате из фона `webrtcService.isCameraDead()`
(readyState==="ended" или muted) → `restartCamera()` через 600мс;
`enableCamera` мёртвую дорожку выбрасывает, а не ставит ей enabled=true.
«Заметки»: кнопка 📝 в списке чатов → notesApi.open → ChatScreen с
isNotes (⏰-шторка: пресеты + сегодня/завтра + ЧЧ:ММ, БЕЗ нативных
пикеров; карточка /reminder с отменой; локальные уведомления через
services/reminders.ts + ресинк после логина). Камера в звонке:
switchCamera (натив track._switchCamera, веб — реаквизиция по facingMode
+ replaceTrack), кнопка 🔄 видна при включённой камере, mirror только у
фронталки. Имя ЛС-чата без собеседника (Заметки) — ветка is_notes в
useChats/getChatName, иначе показывался бы сам юзер.
Сообщения: двойной тап = ❤️-реакция (тоггл; одиночный тап пустой —
задержек нет, тап по фото ловит внутренний Pressable), меню сообщения
(реакции/ответить/переслать/закрепить) — НИЖНИЙ ШИТ Modal-ом поверх
экрана с превью сообщения (инлайн-вариант у нижних сообщений уезжал за
край экрана).
Голосовые (ChatScreen + VoiceMessage): перед записью выгружаются ВСЕ
живые плееры голосовых (unloadAllVoicePlayers — живой Sound держит
аудио-сессию на части андроидов), ретрай prepare — только со СВЕЖИМ
объектом Recording (упавший prepare портит объект навсегда — ловили
«одно голосовое за запуск»), busy-флаг со сторожком 6с. Кнопка 📝
Заметок показывает ошибку вместо молчания (404 = «сервер не обновлён»).
**Видео**: `components/VideoMessage.tsx` — плашка ▶ с именем файла, по тапу
ролик открывается ВО ВЕСЬ ЭКРАН (`MediaViewer` с `video: true`, expo-video
`VideoView` + `nativeControls` + `fullscreenOptions {enable:true}`).
Инлайн-плеер в ленте не держим (был в 0.9.0 и не работал): строка
сообщения обёрнута в Pressable (двойной тап ❤️, долгий — меню) и
Swipeable, они перехватывают касания у нативных контролов — ролик
запускался, но его нельзя было ни остановить, ни перемотать, ни
развернуть; плюс десяток смонтированных плееров = десяток декодеров.
Сохранение в галерею — `MediaLibrary.Asset.create` (класс-API SDK 57;
старый `saveToLibraryAsync` теперь только ругается deprecation-ошибкой и
ничего не делает). «Фото/видео» в скрепке = ImagePicker с
`mediaTypes: ["images","videos"]`, ролики >50 МБ отсеиваются до отправки
по `fileSize`; превью последнего сообщения в списке чатов 🎤/🖼/🎬 —
`filePreview` в useChats (как markers.ts на десктопе).
**Тап по пушу**: `navigationRef` копит переход в `pendingLink`, если
навигатор ещё не готов (холодный старт из пуша приходит раньше, чем
смонтирован контейнер — он ждёт чтения токена), и `flushPendingLink()` в
`onReady` его выполняет; без этого пуш открывал приложение «просто так».
Звонковый пуш вдобавок поднимает плашку «Входящий» через
`setCallInviteHandler` — пока телефон спал, его сокет был мёртв и оффер
звонящего (`send_to_user` без живых сокетов) пропал, по WS плашка уже не
придёт. «Принять» в такой плашке идёт не `joinCall` (отвечать нечему), а
`joinOngoing` → `call_join`; выбор — по `webrtcService.hasPendingOffer`.
Версия своя (0.9.x, app.json+package.json).

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
- Мобилка: `npm install` (postinstall патчит типы rn-webrtc) → `npx tsc
  --noEmit` (шум: TS1323 и две старые ошибки MessageSearchScreen — не
  чинить); веб-бандл `EXPO_OFFLINE=1 CI=1 npx expo export -p web
  --output-dir dist && node scripts/postbuild-web.js`; смоук PWA — сид
  `scratchpad/seed_pwa.py`, uvicorn на 8000, симлинк `server/web →
  mobile/dist` (снести после — иначе попадёт в git status), Playwright
  (`NODE_PATH=$(npm root -g)`); белый экран = смотреть `pageerror` в
  консоли (модуль без веб-реализации → стаб в metro.config). Натив без
  Android SDK: `npx expo prebuild --platform android --no-install
  --template <tgz>` (шаблон — `npm pack expo-template-bare-minimum@sdk-57`;
  gitignored `google-services.json` подложить пустышкой) → проверить
  манифест / MainApplication.kt / res, потом `rm -rf android
  google-services.json`. Плагины с чистой функцией (`applyServiceType`,
  `enableMediaProjectionService`) гоняются node-скриптом без prebuild.

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
6. **Спуф серверных маркеров** (`/quest_card`, `/poll N`): щиты в трёх
   местах (новое сообщение, edit, caption файла) режут ОБА маркера — при
   новых путях создания сообщений добавлять; новые серверные маркеры
   включать в те же щиты (рукописный /poll с живым опросом чата рисовал
   бы вторую рабочую карточку от чужого имени).
7. **SECRET_KEY** стабильный; `VITE_API_URL` пустой в секретах = клиент со
   сломанным адресом (https-фолбэк в api.ts/ws.ts — страховка, не убирать).
8. **chat_updated** идёт без last_message — клиенты мержат с сохранением
   превью; не «упрощать».
9. Проверяй ВЕТКУ и СОСТОЯНИЕ ПРОДА, не только репо: nginx/certbot/coturn
   живут на VPS; «этого нет в репо» ≠ «этого нет».
10. **Мобильный /me при старте**: сетевые/5xx ошибки НЕ разлогинивают —
    токен выкидывается только на 401/403 (AuthContext). Иначе PWA с ярлыка
    разлогинивала людей при секундном отсутствии сети («не могу зайти»).
11. **OTA ходит по runtimeVersion, и он теперь РУЧНОЙ** (`"runtimeVersion":
    "9"` в app.json = сборка 0.9.0 на SDK 57; было `policy: appVersion` —
    из-за него ЛЮБОЙ бамп
    version заставлял всех 50 человек качать APK заново, даже ради
    JS-правки). Правило: `version`/`versionCode` поднимаем свободно, JS
    едет по воздуху ко всем с тем же runtimeVersion; **runtimeVersion
    поднимаем ВРУЧНУЮ И ОБЯЗАТЕЛЬНО при любом нативном изменении** —
    новый нативный модуль, разрешение в манифесте, апгрейд Expo SDK,
    смена config-плагина. Забыть = отправить в старые сборки JS, который
    зовёт отсутствующий натив (краш у всех). Держим runtimeVersion равным
    versionCode той сборки, где натив менялся последний раз. Новый APK
    собирается Actions'ом на изменение app.json/package.json/eas.json.
12. **GitHub-CDN душится у RU-провайдеров**: прямое скачивание release-
    ассетов виснет на ~100% («загрузка не завершена»). Большие файлы для
    людей раздаём со СВОЕГО VPS (`/apk`, app/apk_mirror.py), GitHub — только
    как источник для зеркала и фолбэк.
13. **Плавающие теги базовых образов** (`python:3.12-slim`, `postgres:16`)
    переезжают на новый Debian и ломают сборку ДВАЖДЫ по-разному: сперва
    неразрешимый apt (exit 100), потом — тихо: бинарник с trixie (glibc
    2.41) собрался, скопировался и падал в рантайме на bookworm (2.36).
    Все стадии multi-stage — на ОДНОМ прибитом дистрибутиве, менять
    парой. И любой скопированный бинарник проверять в самой сборке
    (`RUN pg_dump --version`) — иначе о поломке узнаёшь, когда бэкап
    понадобился.
14. **PR смержили, пока я ещё пушил**: хозяин мержит быстро (#79 — через
    полчаса после создания, ночью, и сразу тег + релиз). После мержа
    GitHub удаляет ветку, а обычный push молча ВОССОЗДАЁТ её со старой
    историей — три пакета и возврат ⛽ полдня лежали в ЗАКРЫТОМ PR, я
    даже правил его описание. Перед КАЖДЫМ push'ем/правкой описания —
    `merged` у PR (pull_request_read) + `git fetch origin main`; смержен
    → rebase хвоста на origin/main, push --force-with-lease, НОВЫЙ PR.
    Десктоп-фикс поверх уже выпущенного тега = НОВАЯ версия (2.3.12), а
    не правка «той же» 2.3.11 — автообновление и «Что нового» ходят по
    версии.
15. **Релиз «сделал 2 файла и встал»** (v2.3.12, 17.09): сборка занимает
    секунды, а ВЫГРУЗКА ассетов в GitHub в плохой вечер идёт по 6–9 минут
    на файл (deb 6 мин, exe 9 мин) — шаг `npm run dist` висит 10+ минут
    вместо двух, Windows-задача (`needs: build-linux`) не стартует, и
    черновик стоит с 2–3 файлами. Это не поломка: смотреть Actions, а не
    релиз. Первый прогон висел 13 минут — «Cancel workflow» → «Re-run all
    jobs» отработал: electron-builder нашёл черновик по тегу и доложил/
    заменил файлы (черновик и тег НЕ удалять). Комплект — 6 файлов:
    AppImage, deb, latest-linux.yml, Setup.exe, .blockmap, latest.yml.
    Отменить/перезапустить прогон из сессии нельзя (403 на Actions у
    интеграции) — только хозяин руками. Логи задачи API отдаёт ТОЛЬКО
    после её завершения. Попутно: actions/checkout@v4 и setup-node@v4
    ругаются на Node 20 (принудительно Node 24) — в mobile-release.yml
    подняты до v5 (Node 22), release.yml и mobile-ota.yml — при случае.
16. **Мажорный апгрейд Expo молча меняет РАНТАЙМ, а не только API.** SDK 57
    (0.9.0 → правки в 0.9.1): подменённый глобальный `fetch` уронил все
    загрузки файлов; expo-media-library на вебе требует натив ПРИ ИМПОРТЕ
    (белый экран PWA), а на нативе `saveToLibraryAsync` стал заглушкой с
    руганью; RTCView (SurfaceView) на новой архитектуре стал рисоваться
    ПОВЕРХ оверлеев; нативные контролы expo-video не выживают под
    родительским Pressable, а фулскрин у них по умолчанию ВЫКЛЮЧЕН
    (`fullscreenOptions`). Ничего из этого не ловится ни `tsc`, ни
    веб-сборкой, ни prebuild'ом — только руками на телефоне. Поэтому
    нативный батч идёт тестовой сборкой (publish=false) и правится по
    списку находок, а не мержится «раз собралось».

## Бэклог (одобрено хозяином, порядок — мой)

Пакет от 15.09 (ответы хозяина зафиксированы). СДЕЛАНО в PR #78 (2.3.10,
ждёт мержа): покер (настройки/%-кнопки/«сыграть ещё»/«за газ»/история) и
приз чемпиону сезона (пул, розыгрыш админом, подсказки, раскрытие в
финале); адверсариал-ревью обоих пакетов применено (9 находок). После
мержа хозяину: сервер по правилам (миграции 0013/0014/0015
сами), `git tag v2.3.10`, PWA-раскатка; **до 1 октября** админу завести
пул призов и нажать «Разыграть» в Гандолиуме — иначе финал сентября
пройдёт без приза (розыгрыш на сезон один, задним числом не делается).
Единый стиль десктопа — хозяин выбрал **вариант Б** (иконки + единый
набор эмодзи, без смены типографики), сделан в 2.3.11 (см. раздел
клиента). Вариант «В» (текст сообщений в Neo — Inter, моно только в
хроме) НЕ делаем без отдельной просьбы: моно-переписка кому-то нравится.
Хвосты звонков (ICE-restart/очередь сигналов на мобилке, приём экрана с
компа, экран опоздавшему) — сделаны 16.09 (OTA, натив не менялся).
Экран С телефона — сделан в нативном батче 0.9.0 (см. раздел мобилки).
Покерная шпаргалка + «Шансы» на мобилке — сделаны 16.09:
`screens/chats/PokerAssist.tsx` под столом, математика —
`services/pokerAssist.ts` = КОПИЯ десктопного `pokerAssist.ts` (общего
пакета нет — править оба), тумблер «Шансы» в secureStorage.
Два столбца PWA на широких экранах — сделаны 17.09 (см. раздел мобилки).
PR #79 хозяин смержил и выпустил как 2.3.11 вечером 16.09 — только со
стилем «Б» (грабля №14); хвост (три мобильных пакета, возврат ⛽, видео
в чате, три бага звонков, «обнови меня», лог диска) — PR #80, смержен
и выпущен 2.3.12 вечером 17.09 (релиз собирался с перезапуском —
грабля №15). Ветка после этого перезапущена от main. Батч 18.09 (PR #81,
2.3.14 + сервер): покер — часть чата (вариант 1) + стол с колонкой
переписки (вариант 2) + значок стола в сайдбаре + пуши на файлы +
офсайт вложений. **Нативный батч 0.9.0** (одобрен хозяином 18.09,
ОТДЕЛЬНЫЙ PR после #81): Expo SDK 51→57 + экран С телефона — новый APK,
runtimeVersion 9; мержить в main только после того, как хозяин поставил
тестовую сборку (Mobile Release → Run workflow → publish=false; merge в
main = публикация в mobile-latest, куда смотрит «обнови меня» у всех).
Осталось:
1. По желанию: тот же шрифт Twemoji в PWA (web-сборка мобилки) — на
   нативном андроиде эмодзи всё равно системные.
2. **«Кружки»** (видеосообщения как в Telegram; отложено хозяином 17.09,
   «пока в бэклог»). Оценка: день-два, БЕЗ нового APK — всё нужное уже
   стоит: expo-camera 57 (`CameraView.recordAsync`, нужен `mode="video"`
   + `useMicrophonePermissions`), expo-video для показа, на десктопе
   MediaRecorder (webm). План: файл — обычное видео с именем
   `circle_<ts>.mp4|webm` (как `voice_*` у голосовых), клиенты рисуют
   кругом с object-fit cover (натив: View с borderRadius + overflow
   hidden, Video на TextureView режется), тап = играть/стоп, прогресс по
   ободку; мобилка — кнопка записи с переключением голосовое/кружок,
   живой круглый превью с фронталки, отмена свайпом, лимит ~60с, 480p
   (5–8 МБ); десктоп — запись с вебки в круглом окошке, тот же лимит;
   PWA — MediaRecorder. Ролики с телефона mp4, с компа webm — оба
   форматы играют у всех.

ОТКЛОНЕНО хозяином: «страховка от дна» (сжечь газ и стереть анти-ачивку) —
анти-ачивки ВЕЧНЫЕ, «пусть будут напоминанием» :)
