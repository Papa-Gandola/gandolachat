# GandolaChat Mobile (Android)

React Native (Expo) Android-клиент. Десктопный клиент в `../client/` остаётся
независимым и продолжает работать как раньше.

## Текущее состояние

**Этап 1 — Скелет проекта.** Готова базовая структура, навигация, темы Neo
Venezia и Discord, типизация. Большинство экранов — заглушки (показывают
тайтл и плашку «// СТРАНИЦА В РАЗРАБОТКЕ»). Полностью реализованы: Login,
ChatsList, Chat (DM), Settings (переключатель тем).

Логин сейчас фиктивный — любые имя/пароль выкидывают в основной флоу с
mock-данными. Реальный auth + WebSocket + REST появится на этапе 2.

## Что нужно установить локально (один раз)

1. **Node.js 20+** (наверняка уже есть от десктопного клиента).
2. **EAS CLI:**
   ```bash
   npm install -g eas-cli
   ```
3. **Аккаунт Expo:** зарегистрироваться на https://expo.dev (бесплатно) и
   войти:
   ```bash
   eas login
   ```

Android Studio локально не нужен — `.apk` собирает EAS Build в облаке.

## Первая сборка

```bash
cd mobile
npm install
eas build --profile preview --platform android
```

Первый запуск спросит про создание проекта на Expo — соглашайся, он
автоматически подставит правильный `slug` и `projectId`.

EAS соберёт `.apk` (~10 минут) и пришлёт ссылку. Скачай `.apk` на телефон,
разреши «установку из неизвестных источников», установи. Готово.

## Цикл разработки

После каждого PR от меня:

```bash
git pull
cd mobile
npm install                                # если поменялись зависимости
eas build --profile preview --platform android
```

Скачать новый `.apk`, поставить поверх старого.

## Тема

В приложении: вкладка «Я» → шестерёнка справа сверху → блок «ВНЕШНИЙ ВИД» →
переключение между **Neo Venezia** и **Discord**. Выбор сохраняется через
`expo-secure-store` и переживает рестарты.

## OTA-обновления (без переустановки APK)

Подключено через `expo-updates`. Большинство изменений (UI, экраны,
бизнес-логика, фиксы багов) можно доставить **прозрачно** без новой
сборки APK.

### Когда хватает OTA, а когда нужен новый APK

| Тип изменения | Способ |
|---|---|
| Поправить UI, текст, фикс багов | OTA |
| Новый экран, новая логика | OTA |
| Подключить новую нативную библиотеку | Новый APK |
| Поменять `app.json` (permissions, plugins) | Новый APK |
| Обновить Expo SDK мажорно | Новый APK |
| Сменить `version` в `app.json` | Новый APK |

### Настройка (один раз)

1. Создай токен на https://expo.dev/accounts/papagandola/settings/access-tokens
   — кнопка **Create token**, дай имя `gh-actions`, скопируй значение.
2. Открой https://github.com/Papa-Gandola/gandolachat/settings/secrets/actions
   и добавь секрет **`EXPO_TOKEN`** со скопированным значением.

После этого автообновления работают сами.

### Как работает

- При мерже в `main` любого изменения в `mobile/src/**`, `mobile/App.tsx`,
  `mobile/index.ts` или `mobile/assets/**` — запускается workflow
  `mobile-ota.yml`, который публикует обновление на канал `preview`.
- Установленные APK подхватывают его при следующем запуске (~30 секунд
  после старта) и применяют при следующем рестарте.

### Ручная публикация

```bash
cd mobile
eas update --branch preview --message "Описание"
```

### Когда нужно собрать новый APK

После любого изменения, помеченного «Новый APK» в таблице выше:
```bash
cd mobile
eas build --profile preview --platform android
```
Скачать новый `.apk`, поставить руками. После этого OTA снова работает.

## Структура

```
mobile/
├── App.tsx                  ← точка входа, провайдеры
├── index.ts                 ← регистрация root компонента
├── app.json                 ← конфиг Expo (permissions, icon, plugins)
├── eas.json                 ← профили сборки EAS
├── assets/                  ← иконка, splash (пока копии десктоп-иконки)
└── src/
    ├── theme/               ← Neo + Discord токены, провайдер, hook
    ├── components/          ← примитивы (Avatar, Bubble, AppBar, ...)
    ├── navigation/          ← stacks + tabs, типы маршрутов
    ├── screens/
    │   ├── auth/            ← Login, Register
    │   ├── chats/           ← ChatsList, Chat, GroupChat, ChatInfo, Search, ...
    │   ├── calls/           ← CallsList, ActiveCall
    │   ├── profile/         ← MyProfile, OtherProfile, Settings
    │   └── extras/          ← MediaViewer, StickerPicker
    └── services/            ← AuthContext, mock-данные, (потом — API, WS, WebRTC)
```

## Запланированные следующие этапы

2. **Auth & сервисы.** REST-клиент, WebSocket, реальный логин/регистрация,
   восстановление сессии по токену.
3. **Чаты.** Подключение к серверу, список чатов, открытие чата с историей,
   реальный composer, реакции, реплаи.
4. **Файлы.** Отправка фото/файлов с камеры/галереи, медиа-просмотрщик.
5. **Звонки.** `react-native-webrtc`, mesh до 7 человек, mute/video off,
   входящие звонки.
6. **Покер.** UI стола под мобильный экран, общая серверная логика.
7. **Полировка.** Иконка, splash, экран чужого профиля, инфо о группе.
