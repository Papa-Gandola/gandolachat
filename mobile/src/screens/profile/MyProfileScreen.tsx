import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
import { SettingsIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { NeoButton } from "../../components/NeoButton";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ProfileStackParamList } from "../../navigation/types";
import { useAuth } from "../../services/AuthContext";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "MyProfile">;

export function MyProfileScreen({ navigation }: Props) {
  const theme = useTheme();
  const auth = useAuth();
  const u = auth.user;

  const initial = (u?.username?.[0] ?? "?").toUpperCase();

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? "// Я" : "Профиль"}
        right={
          <IconBtn onPress={() => navigation.navigate("Settings")}>
            <SettingsIcon color={theme.colors.ink} />
          </IconBtn>
        }
      />
      <View style={{ alignItems: "center", paddingVertical: 24 }}>
        <Avatar letter={initial} size={96} bg="#ff7f3d" />
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 18,
            fontWeight: "700",
            color: theme.colors.ink,
            marginTop: 14,
          }}
        >
          {u?.username ?? "—"}
        </Text>
        {u?.status ? (
          <Text
            style={{
              fontFamily: theme.fonts.body,
              fontSize: 12,
              color: theme.colors.inkDim,
              marginTop: 4,
            }}
          >
            {u.status}
          </Text>
        ) : null}
        {u?.is_admin ? (
          <Text
            style={{
              marginTop: 6,
              fontFamily: theme.fonts.mono,
              fontSize: 10,
              color: theme.colors.accent,
              letterSpacing: 1,
            }}
          >
            {theme.decorate ? "// ADMIN" : "Админ"}
          </Text>
        ) : null}
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ padding: 16 }}>
        <NeoButton variant="secondary" onPress={() => auth.signOut()}>
          ВЫЙТИ
        </NeoButton>
      </View>
    </ScreenContainer>
  );
}
