// Expo config that extends app.json. Two overrides:
//
// 1. Android Firebase config — EAS Build supplies the file via the
//    GOOGLE_SERVICES_JSON env var (file type) without committing the
//    credentials. Local dev falls back to mobile/google-services.json
//    (gitignored).
//
// 2. apiUrl / wsUrl — pulled from APP_API_URL / APP_WS_URL env vars at
//    build time. This lets the same source tree produce a dev build
//    pointing at a local IP and a prod build pointing at the HTTPS
//    domain, without editing app.json each release. If the env vars
//    aren't set we keep the values from app.json's "extra" block as a
//    fallback (handy for `expo start` on a LAN).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...(config.android ?? {}),
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON || config.android?.googleServicesFile || "./google-services.json",
  },
  extra: {
    ...(config.extra ?? {}),
    apiUrl: process.env.APP_API_URL || config.extra?.apiUrl,
    wsUrl: process.env.APP_WS_URL || config.extra?.wsUrl,
  },
});
