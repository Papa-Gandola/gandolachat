// Expo config that extends app.json so the static config stays the
// source of truth for everything else. We override only the Android
// Firebase config so EAS Build can supply the file via Environment
// Variable (file type, name GOOGLE_SERVICES_JSON) without having to
// commit the credentials into the repo.
//
// Local dev keeps working with the file at mobile/google-services.json
// (gitignored) — the env var is undefined there so we fall back to it.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...(config.android ?? {}),
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON || config.android?.googleServicesFile || "./google-services.json",
  },
});
