import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { GandolaLogo } from "../../components/GandolaLogo";
import { NeoButton } from "../../components/NeoButton";
import { NeoField } from "../../components/NeoField";
import { ScreenContainer } from "../../components/ScreenContainer";
import { AuthStackParamList } from "../../navigation/types";
import { useAuth } from "../../services/AuthContext";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const theme = useTheme();
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  // TODO: wire to /api/auth/login in step 2. For now stub-login.
  const onSignIn = () => {
    auth.signIn("dev-token-placeholder");
  };

  return (
    <ScreenContainer>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 32 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            justifyContent: "center",
            marginTop: 32,
          }}
        >
          <GandolaLogo size={36} />
          <Text
            style={{
              fontWeight: "700",
              fontSize: 18,
              fontFamily: theme.fonts.mono,
              color: theme.colors.ink,
              letterSpacing: -0.2,
            }}
          >
            Gandola<Text style={{ color: theme.colors.accent }}>Chat</Text>
          </Text>
        </View>

        <View style={{ marginTop: 30, alignItems: "center" }}>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 19,
              fontWeight: "700",
              color: theme.colors.ink,
              letterSpacing: -0.3,
            }}
          >
            {theme.decorate ? "> Добро_пожаловать_" : "Добро пожаловать"}
          </Text>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 11,
              color: theme.colors.inkDim,
              marginTop: 4,
            }}
          >
            {theme.decorate ? "// рады видеть тебя снова" : "Рады видеть тебя снова"}
          </Text>
        </View>

        <View style={{ marginTop: 30, gap: 16 }}>
          <NeoField
            label="ИМЯ ПОЛЬЗОВАТЕЛЯ"
            value={username}
            onChangeText={setUsername}
            placeholder="papa_gandola"
            autoCapitalize="none"
          />
          <NeoField
            label="ПАРОЛЬ"
            value={password}
            onChangeText={setPassword}
            placeholder="●●●●●●●●"
            secureTextEntry
            autoCapitalize="none"
          />
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginTop: 14,
          }}
        >
          <Pressable
            onPress={() => setRemember((v) => !v)}
            style={{
              width: 14,
              height: 14,
              borderRadius: theme.radius.sm,
              borderWidth: 1.5,
              borderColor: theme.colors.accent,
              backgroundColor: remember ? theme.colors.accent : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {remember ? (
              <Text style={{ color: theme.colors.accentText, fontSize: 10, fontWeight: "800" }}>✓</Text>
            ) : null}
          </Pressable>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 12,
              color: theme.colors.inkDim,
            }}
          >
            {theme.decorate ? "запомнить_меня" : "запомнить меня"}
          </Text>
        </View>

        <View style={{ marginTop: 22 }}>
          <NeoButton onPress={onSignIn}>ВОЙТИ</NeoButton>
        </View>

        <View style={{ marginTop: 16, alignItems: "center" }}>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 11,
              color: theme.colors.inkDim,
            }}
          >
            {theme.decorate ? "// нет аккаунта? " : "Нет аккаунта? "}
            <Text
              onPress={() => navigation.navigate("Register")}
              style={{ color: theme.colors.accent }}
            >
              {theme.decorate ? "[зарегистрироваться]" : "зарегистрироваться"}
            </Text>
          </Text>
        </View>

        <View style={{ marginTop: "auto", paddingBottom: 16, alignItems: "center" }}>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 9.5,
              color: theme.colors.inkMuted,
              letterSpacing: 1,
            }}
          >
            v0.1.0 · build dev · {theme.decorate ? "connected ●" : "онлайн"}
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}
