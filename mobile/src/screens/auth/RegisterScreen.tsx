import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { NeoButton } from "../../components/NeoButton";
import { NeoField } from "../../components/NeoField";
import { ScreenContainer } from "../../components/ScreenContainer";
import { AuthStackParamList } from "../../navigation/types";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<AuthStackParamList, "Register">;

export function RegisterScreen({ navigation }: Props) {
  const theme = useTheme();
  const [name, setName] = useState("");
  const [nick, setNick] = useState("");

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? "// РЕГИСТРАЦИЯ" : "Регистрация"}
        sub={theme.decorate ? "шаг 2 из 3" : "Шаг 2 из 3"}
        left={
          <IconBtn onPress={() => navigation.goBack()}>
            <ChevronLeftIcon color={theme.colors.ink} />
          </IconBtn>
        }
        right={
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.accent }}>2/3</Text>
        }
      />

      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 16, marginTop: 8 }}>
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              backgroundColor: i <= 2 ? theme.colors.accent : theme.colors.border,
            }}
          />
        ))}
      </View>

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
          Как тебя звать?
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
          Это имя увидят твои друзья. Можно ник, можно настоящее. Поменять можно когда угодно.
        </Text>

        <View style={{ alignItems: "center", marginBottom: 26 }}>
          <Pressable
            style={{
              width: 92,
              height: 92,
              borderRadius: 46,
              borderWidth: 2,
              borderStyle: "dashed",
              borderColor: theme.colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: theme.colors.inkDim, fontSize: 36 }}>+</Text>
          </Pressable>
          <View
            style={{
              marginTop: -10,
              paddingHorizontal: 10,
              paddingVertical: 3,
              backgroundColor: theme.colors.bg,
              borderWidth: 1,
              borderColor: theme.colors.accent,
            }}
          >
            <Text
              style={{
                color: theme.colors.accent,
                fontFamily: theme.fonts.mono,
                fontSize: 10,
                fontWeight: "700",
                letterSpacing: 1,
              }}
            >
              {theme.decorate ? "[+ ФОТО]" : "+ фото"}
            </Text>
          </View>
        </View>

        <View style={{ gap: 16 }}>
          <NeoField label="ИМЯ" value={name} onChangeText={setName} placeholder="Papa Gandola" />
          <NeoField
            label="@НИКНЕЙМ"
            value={nick}
            onChangeText={setNick}
            placeholder="@papa_gandola"
            autoCapitalize="none"
          />
        </View>

        <View style={{ marginTop: "auto", paddingTop: 24 }}>
          <NeoButton onPress={() => navigation.goBack()}>ПРОДОЛЖИТЬ</NeoButton>
          <Text
            style={{
              textAlign: "center",
              marginTop: 12,
              fontFamily: theme.fonts.mono,
              fontSize: 10.5,
              color: theme.colors.inkMuted,
            }}
          >
            {theme.decorate ? "// нажимая, ты принимаешь условия" : "Нажимая, ты принимаешь условия"}
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}
