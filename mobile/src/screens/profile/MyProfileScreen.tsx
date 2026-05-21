import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, ScrollView, Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
import { SettingsIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { NeoButton } from "../../components/NeoButton";
import { ScreenContainer } from "../../components/ScreenContainer";
import { Section } from "../../components/Section";
import { ProfileStackParamList } from "../../navigation/types";
import { useAuth } from "../../services/AuthContext";
import { useTheme, useThemeControls } from "../../theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "MyProfile">;

export function MyProfileScreen({ navigation }: Props) {
  const theme = useTheme();
  const auth = useAuth();
  const { themeId, setThemeId } = useThemeControls();
  const u = auth.user;
  const initial = (u?.username?.[0] ?? "?").toUpperCase();

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
          <View
            style={{
              padding: 3,
              borderRadius: 56,
              borderWidth: 2,
              borderColor: theme.colors.accent,
            }}
          >
            <Avatar letter={initial} size={104} bg="#ff7f3d" uri={u?.avatar_url} />
          </View>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 18,
              fontWeight: "700",
              color: theme.colors.ink,
              marginTop: 12,
            }}
          >
            {u?.username ?? "—"}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              paddingHorizontal: 12,
              paddingVertical: 4,
              backgroundColor: theme.colors.bgElev,
              borderWidth: 1,
              borderColor: theme.colors.accent + "66",
              borderRadius: theme.radius.sm,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: theme.colors.online,
              }}
            />
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 10.5,
                color: theme.colors.accent,
                fontWeight: "700",
                letterSpacing: 1,
              }}
            >
              {theme.decorate ? "В СЕТИ" : "В сети"}
            </Text>
          </View>
        </View>

        {u?.about ? (
          <>
            <Section>О СЕБЕ</Section>
            <Text
              style={{
                paddingHorizontal: 16,
                paddingBottom: 14,
                fontSize: 13,
                color: theme.colors.inkDim,
                lineHeight: 20,
                fontFamily: theme.fonts.body,
              }}
            >
              {u.about}
            </Text>
          </>
        ) : null}

        <Section>СТАТИСТИКА</Section>
        <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingBottom: 14 }}>
          <StatCard value={String(u?.grammar_errors ?? 0)} label="ошибок грамотности" />
          <StatCard value={u?.is_admin ? "да" : "нет"} label="админ" />
        </View>

        <Section>НАСТРОЙКИ</Section>
        <SettingsRow
          label="Тема"
          value={themeId === "neo" ? "neo venezia" : "discord"}
          onPress={() => setThemeId(themeId === "neo" ? "discord" : "neo")}
        />
        <SettingsRow label="Все настройки" value="" onPress={() => navigation.navigate("Settings")} />

        <View style={{ padding: 16, paddingTop: 24 }}>
          <NeoButton variant="secondary" onPress={() => auth.signOut()}>
            ВЫЙТИ
          </NeoButton>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
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

function SettingsRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const theme = useTheme();
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
      <Text style={{ flex: 1, fontSize: 13.5, color: theme.colors.ink, fontFamily: theme.fonts.body }}>
        {label}
      </Text>
      {value ? (
        <Text style={{ color: theme.colors.inkDim, fontFamily: theme.fonts.mono, fontSize: 11 }}>{value}</Text>
      ) : null}
      <Text style={{ color: theme.colors.inkMuted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}
