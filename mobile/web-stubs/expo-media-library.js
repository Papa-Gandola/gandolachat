// Web stub for expo-media-library.
//
// С SDK 54+ индекс expo-media-library тянет свой «next»-API, который на
// вебе зовёт requireNativeModule('ExpoMediaLibraryNext') ПРЯМО ПРИ ИМПОРТЕ —
// и вся PWA падала белым экраном ещё до логина. Галереи в браузере всё
// равно нет: единственное использование — «Сохранить» в просмотрщике фото
// (MediaViewerScreen), и на вебе он идёт своей веткой (открыть картинку в
// новой вкладке). Стаб держит поверхность модуля, чтобы импорт не падал.
//
// Only loaded for the web bundle (aliased in metro.config.js). Native
// Android builds use the real package and never see this file.
export async function requestPermissionsAsync() {
  return { granted: false, status: "denied", canAskAgain: false, expires: "never" };
}

export async function getPermissionsAsync() {
  return requestPermissionsAsync();
}

export async function saveToLibraryAsync() {
  throw new Error("Сохранение в галерею недоступно в браузере");
}

export async function createAssetAsync() {
  throw new Error("Сохранение в галерею недоступно в браузере");
}

export default {
  requestPermissionsAsync,
  getPermissionsAsync,
  saveToLibraryAsync,
  createAssetAsync,
};
