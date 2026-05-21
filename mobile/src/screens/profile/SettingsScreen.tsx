import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { Label } from "../../components/Label";
import { ScreenContainer } from "../../components/ScreenContainer";
import { Section } from "../../components/Section";
import { ProfileStackParamList } from "../../navigation/types";
import { apiErrorMessage, authApi, chatApi } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { wsService } from "../../services/ws";
import { useTheme, useThemeControls } from "../../theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "Settings">;
type ThemeT = ReturnType<typeof useTheme>;

export function SettingsScreen({ navigation }: Props) {
  const theme = useTheme();
  const { themeId, setThemeId } = useThemeControls();
  const { user } = useAuth();

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? "// НАСТРОЙКИ" : "Настройки"}
        left={
          <IconBtn onPress={() => navigation.goBack()}>
            <ChevronLeftIcon color={theme.colors.ink} />
          </IconBtn>
        }
      />

      <ScrollView style={{ flex: 1 }}>
        <Section>ВНЕШНИЙ ВИД</Section>
        <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          <Label variant="field">ТЕМА</Label>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ThemeChoice
              theme={theme}
              label="Neo Venezia"
              sub="лайм / моно / сканлайны"
              active={themeId === "neo"}
              onPress={() => setThemeId("neo")}
            />
            <ThemeChoice
              theme={theme}
              label="Discord"
              sub="синий / sans / без декора"
              active={themeId === "discord"}
              onPress={() => setThemeId("discord")}
            />
          </View>
        </View>

        {user?.is_admin ? <AdminTools theme={theme} /> : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function AdminTools({ theme }: { theme: ThemeT }) {
  const [pending, setPending] = useState<{ id: number; username: string; created_at: string }[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);

  useEffect(() => {
    authApi.getPendingUsers().then((r) => setPending(r.data)).catch(() => {});
    const onNew = (d: Record<string, unknown>) => {
      const id = d.id as number;
      setPending((prev) =>
        prev.some((p) => p.id === id)
          ? prev
          : [...prev, { id, username: d.username as string, created_at: d.created_at as string }],
      );
    };
    wsService.on("new_pending_user", onNew);
    return () => wsService.off("new_pending_user", onNew);
  }, []);

  const approve = async (id: number) => {
    setBusyId(id);
    try {
      await authApi.approveUser(id);
      setPending((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      Alert.alert("Ошибка", apiErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: number) => {
    setBusyId(id);
    try {
      await authApi.rejectUser(id);
      setPending((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      Alert.alert("Ошибка", apiErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const cleanup = (days: number) => {
    Alert.alert(`Удалить сообщения старше ${days} дней?`, "Действие необратимо для всех чатов.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          setCleanupBusy(true);
          setCleanupMsg(null);
          try {
            const r = await chatApi.adminDeleteOldMessages(days);
            setCleanupMsg(`Удалено: ${r.data.deleted}`);
          } catch (e) {
            setCleanupMsg(apiErrorMessage(e));
          } finally {
            setCleanupBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <>
      <Section>{`АДМИН · ЗАЯВКИ (${pending.length})`}</Section>
      {pending.length === 0 ? (
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkMuted, paddingHorizontal: 16, paddingBottom: 8 }}>
          {theme.decorate ? "// нет новых заявок" : "Нет новых заявок"}
        </Text>
      ) : (
        pending.map((p) => (
          <View
            key={p.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Text style={{ flex: 1, fontFamily: theme.fonts.mono, fontSize: 14, color: theme.colors.ink }}>{p.username}</Text>
            {busyId === p.id ? (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            ) : (
              <>
                <Pressable
                  onPress={() => approve(p.id)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.sm, backgroundColor: theme.colors.online }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800" }}>✓</Text>
                </Pressable>
                <Pressable
                  onPress={() => reject(p.id)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.sm, backgroundColor: theme.colors.danger }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800" }}>✕</Text>
                </Pressable>
              </>
            )}
          </View>
        ))
      )}

      <Section>АДМИН · ОЧИСТКА</Section>
      <Text style={{ fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.inkDim, paddingHorizontal: 16, marginBottom: 8 }}>
        Удалить старые сообщения во всех чатах:
      </Text>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
        {[30, 90, 180].map((d) => (
          <Pressable
            key={d}
            onPress={() => cleanup(d)}
            disabled={cleanupBusy}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: theme.radius.sm,
              borderWidth: 1,
              borderColor: theme.colors.danger,
              opacity: cleanupBusy ? 0.5 : 1,
            }}
          >
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.danger }}>старше {d} дн</Text>
          </Pressable>
        ))}
      </View>
      {cleanupBusy ? (
        <ActivityIndicator size="small" color={theme.colors.accent} style={{ alignSelf: "flex-start", marginLeft: 16 }} />
      ) : null}
      {cleanupMsg ? (
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.accent, paddingHorizontal: 16, paddingBottom: 16 }}>
          {cleanupMsg}
        </Text>
      ) : null}
    </>
  );
}

function ThemeChoice({
  theme,
  label,
  sub,
  active,
  onPress,
}: {
  theme: ThemeT;
  label: string;
  sub: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        padding: 14,
        backgroundColor: active ? theme.colors.bgElevH : theme.colors.bgElev,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent : theme.colors.border,
        borderRadius: theme.radius.md,
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 13,
          fontWeight: "700",
          color: active ? theme.colors.accent : theme.colors.ink,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 10,
          color: theme.colors.inkDim,
          marginTop: 4,
          letterSpacing: 0.6,
        }}
      >
        {sub}
      </Text>
    </Pressable>
  );
}
