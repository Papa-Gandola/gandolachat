import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Updates from "expo-updates";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { CHANGELOG_ID } from "../../changelog";
import { AppBar } from "../../components/AppBar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { ScreenContainer } from "../../components/ScreenContainer";
import { Section } from "../../components/Section";
import { ChangelogModal } from "../../components/WhatsNewModal";
import { ProfileStackParamList } from "../../navigation/types";
import {
  checkForUpdates,
  CheckResult,
  codeInfo,
  getLastResult,
  loadLastCheck,
  myBuildNumber,
  myVersion,
  openApkDownload,
  restartToApply,
  subscribeUpdates,
} from "../../services/updates";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "Updates">;
type ThemeT = ReturnType<typeof useTheme>;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `сегодня в ${hh}:${mm}` : `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} в ${hh}:${mm}`;
}

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Экран «Обновления» (вариант C из эскизов): что установлено, два вида
 * обновлений с пояснениями, проверка по кнопке, время последней проверки.
 * Логика — в services/updates.ts.
 */
export function UpdatesScreen({ navigation }: Props) {
  const theme = useTheme();
  const isWeb = Platform.OS === "web";
  const { isUpdatePending } = Updates.useUpdates();
  const [result, setResult] = useState<CheckResult | null>(getLastResult());
  const [checking, setChecking] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    void loadLastCheck().then((r) => {
      if (r) setResult((cur) => cur ?? r);
    });
    return subscribeUpdates((r) => setResult(r));
  }, []);

  const info = codeInfo();
  const build = myBuildNumber();
  const version = myVersion();

  const check = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await checkForUpdates();
    } finally {
      setChecking(false);
    }
  };

  const restart = async () => {
    setRestarting(true);
    try {
      await restartToApply();
    } catch {
      setRestarting(false);
    }
  };

  const codeDownloaded = isUpdatePending || result?.code === "downloaded";
  const apk = result?.apk ?? null;
  const badges = (codeDownloaded ? 1 : 0) + (apk ? 1 : 0);

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? "// ОБНОВЛЕНИЯ" : "Обновления"}
        left={
          <IconBtn onPress={() => navigation.goBack()}>
            <ChevronLeftIcon color={theme.colors.ink} />
          </IconBtn>
        }
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Крупная версия */}
        <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 }}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 30, fontWeight: "700", color: theme.colors.ink, lineHeight: 34 }}>
            {version}
          </Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkDim, marginTop: 4 }}>
            {isWeb
              ? "PWA · обновляется сама при каждом открытии"
              : [
                  build != null ? `сборка ${build}` : null,
                  info.runtime ? `runtime ${info.runtime}` : null,
                  info.channel ? `канал ${info.channel}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </Text>
        </View>

        {!isWeb ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
            <Kind
              theme={theme}
              title="Код по воздуху"
              value={
                info.embedded
                  ? "встроенный в сборку"
                  : `${info.createdAt ? fmtDate(info.createdAt) : "—"}${info.id ? ` · ${info.id}` : ""}`
              }
              hint="приезжает сам при запуске, ставится за секунды"
            />
            <Kind
              theme={theme}
              title="Сборка APK"
              value={`${version}${build != null ? ` (${build})` : ""}`}
              hint="нужна только при нативных изменениях, ставится вручную"
            />
          </View>
        ) : null}

        {!isWeb ? (
          <>
            <Pressable
              onPress={check}
              disabled={checking}
              style={{
                marginHorizontal: 16,
                marginTop: 14,
                paddingVertical: 12,
                alignItems: "center",
                backgroundColor: theme.colors.accent,
                borderRadius: theme.decorate ? 0 : 8,
                opacity: checking ? 0.7 : 1,
                flexDirection: "row",
                justifyContent: "center",
                gap: 10,
              }}
            >
              {checking ? <ActivityIndicator size="small" color={theme.colors.accentText} /> : null}
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 14, fontWeight: "700", color: theme.colors.accentText }}>
                {checking ? "Проверяю…" : theme.decorate ? "[проверить сейчас]" : "Проверить сейчас"}
              </Text>
            </Pressable>

            {/* Состояние: сперва скачанный код (он важнее — перезапуск в один
                тап), потом новая сборка, потом «всё свежее» */}
            {codeDownloaded ? (
              <State theme={theme} tone="accent">
                <Text style={{ fontWeight: "700", color: theme.colors.ink }}>Есть обновление кода. </Text>
                Скачано, поставится при перезапуске.
                <ActionBtn theme={theme} solid label={restarting ? "перезапускаю…" : "перезапустить сейчас"} onPress={restart} />
              </State>
            ) : null}
            {apk ? (
              <State theme={theme} tone="amber">
                <Text style={{ fontWeight: "700", color: theme.colors.ink }}>
                  Есть новая сборка {apk.version ?? "?"}
                  {apk.build != null ? ` (${apk.build})` : ""}.{" "}
                </Text>
                Её нужно установить как APK — ставится поверх, вход и чаты остаются.
                <ActionBtn theme={theme} label="скачать APK" onPress={openApkDownload} />
              </State>
            ) : null}
            {result && !codeDownloaded && !apk ? (
              result.code === "error" ? (
                <State theme={theme} tone="danger">
                  <Text style={{ fontWeight: "700", color: theme.colors.ink }}>Проверка кода не удалась. </Text>
                  {result.error ?? "сеть?"} Сборка APK проверена: свежее нет.
                </State>
              ) : (
                <State theme={theme} tone="online">
                  <Text style={{ fontWeight: "700", color: theme.colors.ink }}>Всё свежее. </Text>
                  {result.code === "unavailable" ? "Обновления кода тут не работают (dev-сборка). " : ""}
                  Последняя проверка {fmtTime(result.at)}
                </State>
              )
            ) : null}
            {!result ? (
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted, paddingHorizontal: 16, paddingTop: 10 }}>
                {theme.decorate ? "// ещё не проверяли" : "Ещё не проверяли"}
              </Text>
            ) : null}
            {result && (codeDownloaded || apk) ? (
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted, paddingHorizontal: 16, paddingTop: 6 }}>
                {badges === 2 ? "Найдено два обновления. " : ""}Последняя проверка {fmtTime(result.at)}
              </Text>
            ) : null}
          </>
        ) : null}

        <Section>ЧТО НОВОГО</Section>
        <Pressable
          onPress={() => setShowChangelog(true)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 13,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: pressed ? theme.colors.bgElev : "transparent",
          })}
        >
          <Text style={{ flex: 1, fontSize: 13.5, color: theme.colors.ink, fontFamily: theme.fonts.body }}>Список изменений</Text>
          <Text style={{ color: theme.colors.inkDim, fontFamily: theme.fonts.mono, fontSize: 11 }}>{CHANGELOG_ID}</Text>
          <Text style={{ color: theme.colors.inkMuted, fontSize: 18 }}>›</Text>
        </Pressable>
      </ScrollView>
      <ChangelogModal visible={showChangelog} onClose={() => setShowChangelog(false)} />
    </ScreenContainer>
  );
}

function Kind({ theme, title, value, hint }: { theme: ThemeT; title: string; value: string; hint: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.decorate ? 0 : 8, paddingHorizontal: 10, paddingVertical: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: theme.colors.ink }}>{title}</Text>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkDim }}>{value}</Text>
      </View>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted, marginTop: 2 }}>{hint}</Text>
    </View>
  );
}

function State({ theme, tone, children }: { theme: ThemeT; tone: "accent" | "online" | "amber" | "danger"; children: React.ReactNode }) {
  const color = theme.colors[tone];
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderLeftWidth: 2,
        borderLeftColor: color,
        backgroundColor: theme.colors.bgElev,
      }}
    >
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, lineHeight: 18, color: theme.colors.inkDim }}>{children}</Text>
    </View>
  );
}

function ActionBtn({ theme, label, onPress, solid }: { theme: ThemeT; label: string; onPress: () => void; solid?: boolean }) {
  return (
    <Text
      onPress={onPress}
      style={{
        fontFamily: theme.fonts.mono,
        fontSize: 12,
        fontWeight: "700",
        color: solid ? theme.colors.accentText : theme.colors.accent,
        backgroundColor: solid ? theme.colors.accent : "transparent",
        borderWidth: solid ? 0 : 1,
        borderColor: theme.colors.accent,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginTop: 8,
        alignSelf: "flex-start",
        overflow: "hidden",
        borderRadius: theme.decorate ? 0 : 6,
      }}
    >
      {theme.decorate ? `[${label}]` : label}
    </Text>
  );
}
