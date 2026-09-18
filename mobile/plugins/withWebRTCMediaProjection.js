/**
 * Шеринг экрана С ТЕЛЕФОНА (MediaProjection) — две нативные правки, без
 * которых getDisplayMedia() из react-native-webrtc не работает на
 * Android 14+ или роняет приложение.
 *
 * 1. WebRTCModuleOptions.enableMediaProjectionService = true в
 *    MainApplication.onCreate. С Android 14 захват экрана разрешён только
 *    процессу с РАБОТАЮЩИМ foreground-сервисом типа mediaProjection, причём
 *    сервис надо поднять ПОСЛЕ согласия пользователя в системном диалоге и
 *    ДО getMediaProjection(). Библиотека умеет это сама (свой
 *    MediaProjectionService, объявлен в её манифесте с нужным типом), но
 *    по умолчанию флаг выключен — и тогда getDisplayMedia падает
 *    SecurityException'ом. Флаг — java-поле статического синглтона,
 *    из JS его не выставить: только правка MainApplication при prebuild.
 *
 * 2. Иконка res/drawable/ic_notification. Уведомление того самого сервиса
 *    библиотека строит по getIdentifier("ic_notification", "drawable"), а
 *    саму картинку НЕ поставляет: без неё id = 0 → «Invalid notification (no
 *    valid small icon)» → краш при первом же старте шеринга. Кладём
 *    bitmap-алиас на notification_icon, который генерирует плагин
 *    expo-notifications из app.json (порядок dangerous-модов неважен —
 *    ссылка резолвится на этапе сборки ресурсов).
 *
 * Разрешение FOREGROUND_SERVICE_MEDIA_PROJECTION — в app.json.permissions.
 */
const fs = require("fs");
const path = require("path");
const { AndroidConfig, withDangerousMod, withMainApplication } = require("@expo/config-plugins");

const FLAG = "WebRTCModuleOptions.getInstance().enableMediaProjectionService = true";
const IMPORT = "com.oney.WebRTCModule.WebRTCModuleOptions";

const ICON_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Сгенерировано plugins/withWebRTCMediaProjection.js: маленькая иконка
     уведомления «Screen sharing» из react-native-webrtc (библиотека ищет
     drawable/ic_notification, но не поставляет его). -->
<bitmap xmlns:android="http://schemas.android.com/apk/res/android"
    android:src="@drawable/notification_icon" />
`;

/** Чистая правка исходника MainApplication (java/kotlin) — вынесена, чтобы
 *  прогонять тестом без prebuild. Идемпотентна. */
function enableMediaProjectionService(contents, language) {
  if (contents.includes(FLAG)) return contents;
  const isJava = language === "java";
  let out = AndroidConfig.CodeMod.addImports(contents, [IMPORT], isJava);
  out = AndroidConfig.CodeMod.appendContentsInsideDeclarationBlock(
    out,
    "onCreate",
    `    ${FLAG}${isJava ? ";" : ""}\n`,
  );
  return out;
}

module.exports = function withWebRTCMediaProjection(config) {
  config = withMainApplication(config, (cfg) => {
    cfg.modResults.contents = enableMediaProjectionService(cfg.modResults.contents, cfg.modResults.language);
    return cfg;
  });
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "drawable");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "ic_notification.xml"), ICON_XML);
      return cfg;
    },
  ]);
  return config;
};

module.exports.enableMediaProjectionService = enableMediaProjectionService;
module.exports.ICON_XML = ICON_XML;
