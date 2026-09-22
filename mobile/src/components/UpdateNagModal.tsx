import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Platform, Pressable, Text, View } from "react-native";

import { CHANGELOG_ID } from "../changelog";
import { useAuth } from "../services/AuthContext";
import * as SecureStore from "../services/secureStorage";
import { ApkInfo, fetchApkInfo, myBuildNumber, myVersion, noteApkInfo, openApkDownload } from "../services/updates";
import { useTheme } from "../theme";

// «Обнови меня до x.x.x» — для НАТИВНОГО андроида, у которого стоит старый
// APK. JS-правки приезжают по OTA сами, а вот новый натив (runtimeVersion)
// человек должен поставить руками — и без напоминания старые сборки живут
// месяцами. Сравниваем номер сборки (versionCode) установленного
// приложения с тем, что лежит в зеркале сервера (GET /apk/info → build,
// парсится из имени релиза mobile-latest). Показываем не при каждом
// заходе, а раз в три (1-й, 4-й, 7-й…): счётчик заходов на каждую сборку
// зеркала свой — вышел новый APK, отсчёт с начала. «Заход» = холодный
// старт или возврат из фона после ≥2 часов. Пока висит «Что нового»
// (свежий OTA), молчим — два окна разом это перебор; PWA не трогаем: у
// неё обновлять нечего.
// Проверка сборки и её адрес — в services/updates.ts (общие с экраном
// «Обновления» в профиле).
const COUNT_KEY = "gandola.updateNag";
const CHANGELOG_SEEN_KEY = "gandola.changelogSeen";
const EVERY = 3;
const BACKGROUND_RESET_MS = 2 * 60 * 60 * 1000;

export function UpdateNagModal() {
  const theme = useTheme();
  const { user } = useAuth();
  const [latest, setLatest] = useState<ApkInfo | null>(null);
  const [visible, setVisible] = useState(false);
  const backgroundSince = useRef<number | null>(null);

  const check = async () => {
    if (Platform.OS === "web") return;
    const mine = myBuildNumber();
    if (mine == null) return;
    try {
      // Свежий OTA ещё не показал «Что нового» — этот заход не считаем.
      if ((await SecureStore.getItemAsync(CHANGELOG_SEEN_KEY)) !== CHANGELOG_ID) return;
      const info = await fetchApkInfo();
      if (!info || info.build == null || info.build <= mine) return;
      // Бейдж у кнопки «Обновления» в профиле — независимо от того,
      // покажем ли окно в этот заход.
      noteApkInfo(info);
      let count = 0;
      try {
        const saved = JSON.parse((await SecureStore.getItemAsync(COUNT_KEY)) ?? "null") as { build: number; count: number } | null;
        if (saved && saved.build === info.build) count = saved.count;
      } catch {
        // битая запись — начинаем счёт заново
      }
      count += 1;
      await SecureStore.setItemAsync(COUNT_KEY, JSON.stringify({ build: info.build, count }));
      if ((count - 1) % EVERY !== 0) return;
      setLatest(info);
      setVisible(true);
    } catch {
      // сеть/хранилище — напомним в следующий раз
    }
  };

  useEffect(() => {
    if (!user) return;
    void check();
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") {
        const since = backgroundSince.current;
        backgroundSince.current = null;
        if (since != null && Date.now() - since >= BACKGROUND_RESET_MS) void check();
      } else if (st === "background") {
        backgroundSince.current = Date.now();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!visible || !latest) return null;
  const mineVersion = myVersion();
  const target = latest.version ?? latest.release_name ?? "новой";
  const title = theme.decorate ? "// ОБНОВИ МЕНЯ" : "Обнови меня";
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: theme.colors.bg,
            borderRadius: theme.decorate ? 0 : 14,
            borderWidth: 1,
            borderColor: theme.decorate ? theme.colors.accent : theme.colors.border,
            padding: 20,
          }}
        >
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 16, fontWeight: "700", color: theme.colors.accent, marginBottom: 12 }}>
            {title}
          </Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 14, lineHeight: 21, color: theme.colors.ink }}>
            Обнови меня до {target} версии — у тебя {mineVersion}.
          </Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, lineHeight: 18, color: theme.colors.inkDim, marginTop: 8 }}>
            Новый APK ставится поверх старого, ничего не слетает: ни вход, ни чаты.
          </Text>
          <Pressable
            onPress={() => {
              setVisible(false);
              openApkDownload();
            }}
            style={{
              marginTop: 16,
              backgroundColor: theme.colors.accent,
              borderRadius: theme.decorate ? 0 : 8,
              paddingVertical: 11,
              alignItems: "center",
            }}
          >
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 14, fontWeight: "700", color: theme.colors.accentText }}>
              Скачать APK
            </Text>
          </Pressable>
          <Pressable onPress={() => setVisible(false)} style={{ marginTop: 10, paddingVertical: 9, alignItems: "center" }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.inkDim }}>Позже</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
