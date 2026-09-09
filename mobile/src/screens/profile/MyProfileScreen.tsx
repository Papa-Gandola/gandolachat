import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
import { DotaRankBadge } from "../../components/DotaRankBadge";
import { SettingsIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { NeoButton } from "../../components/NeoButton";
import { ScreenContainer } from "../../components/ScreenContainer";
import { Section } from "../../components/Section";
import { ProfileStackParamList } from "../../navigation/types";
import { apiErrorMessage, authApi, userApi } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { useTheme, useThemeControls } from "../../theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "MyProfile">;
type ThemeT = ReturnType<typeof useTheme>;

export function MyProfileScreen({ navigation }: Props) {
  const theme = useTheme();
  const auth = useAuth();
  const { themeId, setThemeId } = useThemeControls();
  const u = auth.user;
  const initial = (u?.username?.[0] ?? "?").toUpperCase();
  const [avatarBusy, setAvatarBusy] = useState(false);

  const pickAvatar = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      setAvatarBusy(true);
      const updated = await userApi.uploadAvatar({
        uri: a.uri,
        name: a.fileName ?? `avatar_${Date.now()}.jpg`,
        type: a.mimeType ?? "image/jpeg",
      });
      auth.updateUser(updated);
    } catch (err) {
      Alert.alert("Не удалось обновить аватар", apiErrorMessage(err));
    } finally {
      setAvatarBusy(false);
    }
  };

  const saveField = async (data: { username?: string; status?: string; about?: string }) => {
    const res = await userApi.updateProfile(data);
    auth.updateUser(res.data);
  };

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? "// МОЙ ПРОФИЛЬ" : "Мой профиль"}
        right={
          <IconBtn onPress={() => navigation.navigate("Settings")}>
            <SettingsIcon color={theme.colors.ink} />
          </IconBtn>
        }
      />

      <ScrollView style={{ flex: 1 }}>
        {/* Avatar block */}
        <View style={{ alignItems: "center", paddingTop: 24, paddingBottom: 18 }}>
          <Pressable onPress={pickAvatar} disabled={avatarBusy} style={{ alignItems: "center" }}>
            <View style={{ padding: 3, borderRadius: 56, borderWidth: 2, borderColor: theme.colors.accent }}>
              <Avatar letter={initial} size={104} bg="#ff7f3d" uri={u?.avatar_url} />
            </View>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.accent, marginTop: 8 }}>
              {avatarBusy ? "загрузка…" : theme.decorate ? "[сменить фото]" : "Сменить фото"}
            </Text>
          </Pressable>
          <Text
            style={{ fontFamily: theme.fonts.mono, fontSize: 18, fontWeight: "700", color: theme.colors.ink, marginTop: 8 }}
          >
            {u?.username ?? "—"}
          </Text>
        </View>

        <Section>ПРОФИЛЬ</Section>
        <EditableRow
          theme={theme}
          label="никнейм"
          value={u?.username ?? ""}
          onSave={(v) => saveField({ username: v })}
        />
        <EditableRow
          theme={theme}
          label="статус"
          value={u?.status ?? ""}
          placeholder={theme.decorate ? "не задан" : "Не задан"}
          maxLength={50}
          onSave={(v) => saveField({ status: v })}
        />
        <EditableRow
          theme={theme}
          label="о себе"
          value={u?.about ?? ""}
          placeholder={theme.decorate ? "ничего не заполнено" : "Ничего не заполнено"}
          multiline
          maxLength={500}
          onSave={(v) => saveField({ about: v })}
        />

        <Section>СТАТИСТИКА</Section>
        <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingBottom: 14 }}>
          <StatCard theme={theme} value={String(u?.grammar_errors ?? 0)} label="ошибок грамотности" />
          <StatCard theme={theme} value={u?.is_admin ? "да" : "нет"} label="админ" />
        </View>

        <Section>DOTA 2</Section>
        <DotaSection theme={theme} />

        <Section>БЕЗОПАСНОСТЬ</Section>
        <PasswordChange theme={theme} />

        <Section>НАСТРОЙКИ</Section>
        <WebPushRow theme={theme} />
        <SettingsRow
          theme={theme}
          label="Тема"
          value={themeId === "neo" ? "neo venezia" : "discord"}
          onPress={() => setThemeId(themeId === "neo" ? "discord" : "neo")}
        />
        <SettingsRow theme={theme} label="Все настройки" value="" onPress={() => navigation.navigate("Settings")} />

        <View style={{ padding: 16, paddingTop: 24 }}>
          <NeoButton variant="secondary" onPress={() => auth.signOut()}>
            ВЫЙТИ
          </NeoButton>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function EditableRow({
  theme,
  label,
  value,
  placeholder,
  multiline,
  maxLength,
  onSave,
}: {
  theme: ThemeT;
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = () => {
    setDraft(value);
    setErr(null);
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 10,
          color: theme.colors.inkMuted,
          letterSpacing: 1,
          textTransform: "uppercase",
          fontWeight: "700",
          marginBottom: 4,
        }}
      >
        {theme.decorate ? `// ${label}` : label}
      </Text>
      {editing ? (
        <View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            multiline={multiline}
            maxLength={maxLength}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.inkMuted}
            style={{
              fontFamily: theme.fonts.body,
              fontSize: 14,
              color: theme.colors.ink,
              backgroundColor: theme.colors.bgInput,
              borderRadius: theme.radius.sm,
              borderWidth: 1,
              borderColor: theme.colors.accent,
              paddingHorizontal: 10,
              paddingVertical: 8,
              minHeight: multiline ? 70 : undefined,
            }}
          />
          {err ? (
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.danger, marginTop: 4 }}>
              {err}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Pressable
              onPress={save}
              disabled={busy}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: theme.radius.sm,
                backgroundColor: theme.colors.accent,
              }}
            >
              {busy ? (
                <ActivityIndicator size="small" color={theme.colors.accentText} />
              ) : (
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: theme.colors.accentText }}>
                  {theme.decorate ? "[сохранить]" : "Сохранить"}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setEditing(false)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: theme.radius.sm,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkDim }}>
                {theme.decorate ? "[отмена]" : "Отмена"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={open} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              flex: 1,
              fontFamily: theme.fonts.body,
              fontSize: 14,
              color: value ? theme.colors.ink : theme.colors.inkMuted,
              fontStyle: value ? "normal" : "italic",
            }}
          >
            {value || placeholder || ""}
          </Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.accent }}>
            {theme.decorate ? "[edit]" : "✎"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function DotaSection({ theme }: { theme: ThemeT }) {
  const auth = useAuth();
  const u = auth.user;
  const linked = !!u?.dota_account_id;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const run = async (fn: () => Promise<{ data: import("../../services/api").UserOut }>) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fn();
      auth.updateUser(res.data);
      setInput("");
      setConfirmUnlink(false);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    fontFamily: theme.fonts.mono,
    fontSize: 13,
    color: theme.colors.ink,
    backgroundColor: theme.colors.bgInput,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 8,
  } as const;

  const btn = (bg: string, fg: string, border?: string) =>
    ({
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: theme.radius.sm,
      backgroundColor: bg,
      borderWidth: border ? 1 : 0,
      borderColor: border,
      opacity: busy ? 0.6 : 1,
    }) as const;

  if (!linked) {
    return (
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11.5, color: theme.colors.inkDim, lineHeight: 17 }}>
          Привяжи Steam — появится звание, а катки начнут засчитываться в Гандолиум ⛽
        </Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ссылка на Steam-профиль или Friend ID"
          placeholderTextColor={theme.colors.inkMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={inputStyle}
        />
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted }}>
          Подойдёт: steamcommunity.com/profiles/…, ссылка Dotabuff/OpenDota или Friend ID из Доты
        </Text>
        {err ? (
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.danger }}>{err}</Text>
        ) : null}
        <Pressable
          onPress={() => input.trim() && run(() => userApi.linkSteam(input.trim()))}
          disabled={busy || !input.trim()}
          style={btn(theme.colors.accent, theme.colors.accentText)}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.colors.accentText} />
          ) : (
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: theme.colors.accentText, textAlign: "center" }}>
              {theme.decorate ? "[ПРИВЯЗАТЬ]" : "Привязать"}
            </Text>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {u?.dota_rank_tier ? (
          <DotaRankBadge rankTier={u.dota_rank_tier} leaderboardRank={u.dota_leaderboard_rank} />
        ) : (
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkMuted, fontStyle: "italic" }}>
            звание пока не видно
          </Text>
        )}
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted }}>
          ID {u?.dota_account_id}
        </Text>
      </View>
      {!u?.dota_rank_tier ? (
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted, lineHeight: 15 }}>
          Проверь в Доте: Настройки → Приватность → «Сделать общедоступной статистику матчей», сыграй катку и жми «Обновить»
        </Text>
      ) : null}
      {err ? (
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.danger }}>{err}</Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Pressable onPress={() => run(() => userApi.refreshSteam())} disabled={busy} style={btn(theme.colors.bgElev, theme.colors.ink, theme.colors.border)}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.ink }}>
            {busy ? "…" : theme.decorate ? "[обновить]" : "Обновить"}
          </Text>
        </Pressable>
        {!confirmUnlink ? (
          <Pressable onPress={() => setConfirmUnlink(true)} disabled={busy} style={btn("transparent", theme.colors.inkDim, theme.colors.border)}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkDim }}>
              {theme.decorate ? "[отвязать]" : "Отвязать"}
            </Text>
          </Pressable>
        ) : (
          <>
            <Pressable onPress={() => run(() => userApi.unlinkSteam())} disabled={busy} style={btn("transparent", theme.colors.danger, theme.colors.danger)}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.danger }}>
                {theme.decorate ? "[точно отвязать]" : "Точно отвязать"}
              </Text>
            </Pressable>
            <Pressable onPress={() => setConfirmUnlink(false)} style={btn("transparent", theme.colors.inkDim, theme.colors.border)}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkDim }}>
                {theme.decorate ? "[отмена]" : "Отмена"}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

// Тумблер Web Push — только в вебе (PWA). Первичное включение обязано идти
// от жеста пользователя (правило iOS для requestPermission), поэтому кнопка,
// а не авто-подписка.
function WebPushRow({ theme }: { theme: ThemeT }) {
  const [state, setState] = useState<import("../../services/webPush").WebPushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    import("../../services/webPush").then((m) => m.webPushState().then(setState)).catch(() => {});
  }, []);

  if (Platform.OS !== "web" || state === null || state === "unsupported") return null;

  const label = "Уведомления";
  const value = state === "on" ? "вкл" : state === "denied" ? "запрещены в Safari" : "выкл";

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const m = await import("../../services/webPush");
      if (state === "on") {
        await m.webPushDisable();
        setState("off");
      } else if (state === "off") {
        setState(await m.webPushEnable());
      } else {
        Alert.alert(
          "Уведомления запрещены",
          "Разреши их для этого сайта в настройках Safari (или переустанови ярлык) и попробуй снова.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return <SettingsRow theme={theme} label={label} value={busy ? "…" : value} onPress={toggle} />;
}

function PasswordChange({ theme }: { theme: ThemeT }) {
  const [open, setOpen] = useState(false);
  const [oldp, setOldp] = useState("");
  const [newp, setNewp] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!oldp || !newp) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await authApi.changePassword(oldp, newp);
      setMsg("Пароль изменён");
      setOldp("");
      setNewp("");
      setOpen(false);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    color: theme.colors.ink,
    backgroundColor: theme.colors.bgInput,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  } as const;

  if (!open) {
    return (
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        {msg ? (
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.accent, marginBottom: 8 }}>
            {theme.decorate ? `// ${msg}` : msg}
          </Text>
        ) : null}
        <Pressable onPress={() => setOpen(true)}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.accent }}>
            {theme.decorate ? "[сменить пароль]" : "Сменить пароль"}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
      <TextInput
        value={oldp}
        onChangeText={setOldp}
        placeholder={theme.decorate ? "текущий пароль" : "Текущий пароль"}
        placeholderTextColor={theme.colors.inkMuted}
        secureTextEntry
        autoCapitalize="none"
        style={inputStyle}
      />
      <TextInput
        value={newp}
        onChangeText={setNewp}
        placeholder={theme.decorate ? "новый пароль" : "Новый пароль"}
        placeholderTextColor={theme.colors.inkMuted}
        secureTextEntry
        autoCapitalize="none"
        style={inputStyle}
      />
      {err ? (
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.danger }}>{err}</Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={submit}
          disabled={busy || !oldp || !newp}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.accent,
            opacity: busy || !oldp || !newp ? 0.5 : 1,
          }}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.colors.accentText} />
          ) : (
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: theme.colors.accentText }}>
              {theme.decorate ? "[сменить]" : "Сменить"}
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => {
            setOpen(false);
            setErr(null);
            setOldp("");
            setNewp("");
          }}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: theme.radius.sm,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkDim }}>
            {theme.decorate ? "[отмена]" : "Отмена"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function StatCard({ theme, value, label }: { theme: ThemeT; value: string; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        padding: 10,
        backgroundColor: theme.colors.bgElev,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.accent,
        borderRadius: theme.radius.sm,
      }}
    >
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 15, fontWeight: "700", color: theme.colors.ink }}>
        {value}
      </Text>
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 9.5,
          color: theme.colors.inkMuted,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function SettingsRow({
  theme,
  label,
  value,
  onPress,
}: {
  theme: ThemeT;
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.bgElev : "transparent",
      })}
    >
      <Text style={{ flex: 1, fontSize: 13.5, color: theme.colors.ink, fontFamily: theme.fonts.body }}>{label}</Text>
      {value ? (
        <Text style={{ color: theme.colors.inkDim, fontFamily: theme.fonts.mono, fontSize: 11 }}>{value}</Text>
      ) : null}
      <Text style={{ color: theme.colors.inkMuted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}
