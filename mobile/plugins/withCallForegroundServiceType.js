/**
 * Тип фонового сервиса звонка в манифесте (Android 14+).
 *
 * ЗАЧЕМ. notifee объявляет свой сервис в манифесте своей библиотеки жёстко:
 *   <service android:name="app.notifee.core.ForegroundService"
 *            android:foregroundServiceType="shortService" />
 * А `shortService` — это «коротко поработать и закончить»: система даёт ему
 * несколько минут и убивает по таймауту. Живой трейс с телефона хозяина:
 *   «A foreground service of FOREGROUND_SERVICE_TYPE_SHORT_SERVICE did not
 *    stop within a timeout: ComponentInfo{com.gandola.chat/
 *    app.notifee.core.ForegroundService}»
 * — то есть «Гандола не отвечает» в середине звонка прилетало РОВНО за то,
 * что разговор длится дольше, чем позволено короткому сервису. Главный поток
 * в том же трейсе стоял в обычном Looper'е: приложение не висло вообще.
 *
 * Тип нельзя поменять из JS: значение runtime должно быть объявлено в
 * манифесте, а манифест пересобирается только новым APK. Поэтому — плагин:
 * переопределяем тип на microphone|camera (разрешения
 * FOREGROUND_SERVICE_MICROPHONE/CAMERA в app.json уже есть). У этих типов нет
 * таймаута, и именно camera даёт сервису право держать камеру в фоне — без
 * него Андроид её отбирал, и у собеседника намертво застывал кадр.
 *
 * tools:replace обязателен: без него манифест-мержер падает на конфликте
 * значений с библиотечным shortService.
 */
const { AndroidConfig, withAndroidManifest } = require("@expo/config-plugins");

const SERVICE_NAME = "app.notifee.core.ForegroundService";
const SERVICE_TYPES = "microphone|camera";
const TOOLS_NS = "http://schemas.android.com/tools";

/** Чистая правка манифеста — вынесена, чтобы её можно было прогнать
 *  тестом без полного prebuild. */
function applyServiceType(manifest) {
  {
    // xmlns:tools в корне — иначе tools:replace не распознается
    manifest.manifest.$ = manifest.manifest.$ || {};
    manifest.manifest.$["xmlns:tools"] = TOOLS_NS;

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.service = app.service || [];

    let service = app.service.find(
      (s) => s && s.$ && s.$["android:name"] === SERVICE_NAME,
    );
    if (!service) {
      service = { $: { "android:name": SERVICE_NAME, "android:exported": "false" } };
      app.service.push(service);
    }
    service.$["android:foregroundServiceType"] = SERVICE_TYPES;

    const replace = new Set(
      (service.$["tools:replace"] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    replace.add("android:foregroundServiceType");
    service.$["tools:replace"] = Array.from(replace).join(",");
  }
  return manifest;
}

module.exports = function withCallForegroundServiceType(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = applyServiceType(cfg.modResults);
    return cfg;
  });
};

module.exports.applyServiceType = applyServiceType;
