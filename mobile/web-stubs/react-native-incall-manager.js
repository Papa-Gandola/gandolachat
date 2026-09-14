// Web stub for react-native-incall-manager.
//
// Библиотека дёргает андроидный AudioManager, чтобы переключать звук звонка
// между разговорным динамиком и громкой связью. В браузере (PWA) маршрута
// звука у нас нет — им распоряжается сама система, — поэтому все методы
// пустые, а кнопка «динамик» в вебе просто не показывается (Platform.OS).
//
// Подключается только в веб-бандле (алиас в metro.config.js).
const noop = () => {};

export default {
  start: noop,
  stop: noop,
  setForceSpeakerphoneOn: noop,
  setSpeakerphoneOn: noop,
  setKeepScreenOn: noop,
  turnScreenOn: noop,
  turnScreenOff: noop,
};
