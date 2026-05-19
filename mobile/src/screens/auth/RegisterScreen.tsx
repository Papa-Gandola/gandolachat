import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { NeoButton } from "../../components/NeoButton";
import { NeoField } from "../../components/NeoField";
import { ScreenContainer } from "../../components/ScreenContainer";
import { AuthStackParamList } from "../../navigation/types";
import { useAuth } from "../../services/AuthContext";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<AuthStackParamList, "Register">;

export function RegisterScreen({ navigation }: Props) {
  const theme = useTheme();
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);

  const submit = async () => {
    if (!username.trim() || !password) return;
    try {
      const res = await auth.register(username.trim(), password);
      if (res.pending) {
        setPendingMsg(res.message || "Заявка отправлена, ждём подтверждения админа.");
      }
      // If !pending, AuthContext set token → root nav swaps in the Main stack
      // automatically.
    } catch {
      // error visible via auth.error
    }
  };

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? "// РЕГИСТРАЦИЯ" : "Регистрация"}
        left={
          <IconBtn onPress={() => navigation.goBack()}>
            <ChevronLeftIcon color={theme.colors.ink} />
          </IconBtn>
        }
      />

      <View style={{ flex: 1, paddingHorizontal: 22, paddingTop: 24 }}>
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 16,
            fontWeight: "700",
            color: theme.colors.ink,
            marginBottom: 4,
          }}
        >
          Создать аккаунт
        </Text>
        <Text
          style={{
            fontFamily: theme.fonts.body,
            fontSize: 12.5,
            color: theme.colors.inkDim,
            lineHeight: 18,
            marginBottom: 24,
          }}
        >
          Регистрация требует подтверждения от админа. После создания заявки админ её одобрит, и можно будет войти.
        </Text>

        <View style={{ gap: 16 }}>
          <NeoField
            label="ИМЯ ПОЛЬЗОВАТЕЛЯ"
            value={username}
            onChangeText={(v) => {
              setUsername(v);
              auth.clearError();
              setPendingMsg(null);
            }}
            placeholder="papa_gandola"
            autoCapitalize="none"
          />
          <NeoField
            label="ПАРОЛЬ"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              auth.clearError();
              setPendingMsg(null);
            }}
            placeholder="не менее 6 символов"
            secureTextEntry
            autoCapitalize="none"
          />
        </View>

        {auth.error ? (
          <Text
            style={{
              marginTop: 14,
              fontFamily: theme.fonts.mono,
              fontSize: 12,
              color: theme.colors.danger,
            }}
          >
            {theme.decorate ? `! ${auth.error}` : auth.error}
          </Text>
        ) : null}

        {pendingMsg ? (
          <View
            style={{
              marginTop: 14,
              padding: 12,
              backgroundColor: theme.colors.bgElev,
              borderWidth: 1,
              borderColor: theme.colors.accent,
              borderRadius: theme.radius.md,
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 11,
                color: theme.colors.accent,
                fontWeight: "700",
                marginBottom: 4,
                letterSpacing: 1,
              }}
            >
              {theme.decorate ? "// ЗАЯВКА_ОТПРАВЛЕНА" : "Заявка отправлена"}
            </Text>
            <Text
              style={{
                fontFamily: theme.fonts.body,
                fontSize: 12.5,
                color: theme.colors.inkDim,
                lineHeight: 18,
              }}
            >
              {pendingMsg}
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: "auto", paddingTop: 24, paddingBottom: 16 }}>
          <NeoButton onPress={submit} disabled={auth.loading || !username.trim() || !password}>
            {auth.loading ? "ОТПРАВКА..." : "ОТПРАВИТЬ ЗАЯВКУ"}
          </NeoButton>
        </View>
      </View>
    </ScreenContainer>
  );
}
