module.exports = function (api) {
  api.cache(true);
  return {
    // SDK 57 / reanimated 4: плагин ворклетов babel-preset-expo подключает
    // сам, когда установлен react-native-worklets; ручной
    // "react-native-reanimated/plugin" (SDK 51) теперь дублировал бы его.
    presets: ["babel-preset-expo"],
  };
};
