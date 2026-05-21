import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
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

        <Section>БЕЗОПАСНОСТЬ</Section>
        <PasswordChange theme={theme} />

        <Section>НАСТРОЙКИ</Section>
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
