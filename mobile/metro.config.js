// Metro config — extends Expo's defaults with web-only module aliases.
//
// react-native-webrtc and @notifee/react-native are native-only: they call
// requireNativeComponent / native modules that don't exist in the browser, so
// importing them in the web bundle crashes at load ("requireNativeComponent is
// not a function"). For the web platform we redirect those imports to local
// stubs in web-stubs/. iOS / Android builds are unaffected and use the real
// packages.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const WEB_ALIASES = {
  "react-native-webrtc": path.resolve(__dirname, "web-stubs/react-native-webrtc.js"),
  "@notifee/react-native": path.resolve(__dirname, "web-stubs/notifee.js"),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && WEB_ALIASES[moduleName]) {
    return { type: "sourceFile", filePath: WEB_ALIASES[moduleName] };
  }
  // Fall back to Metro's default resolver for everything else.
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
