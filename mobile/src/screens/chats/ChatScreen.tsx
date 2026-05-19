import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { Avatar } from "../../components/Avatar";
import { Bubble } from "../../components/Bubble";
import { ChevronLeftIcon, PhoneIcon, SendIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { WERFIRE_THREAD } from "../../services/mockData";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "Chat">;

export function ChatScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const [draft, setDraft] = useState("");
  const { name } = route.params;

  return (
    <ScreenContainer>
      {/* Custom header (richer than the generic AppBar — avatar + back) */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 8,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.bg,
        }}
      >
        <IconBtn onPress={() => navigation.goBack()}>
          <ChevronLeftIcon color={theme.colors.ink} />
        </IconBtn>
        <Avatar letter={name[0] ?? "?"} size={36} bg="#ef5350" online />
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontWeight: "700",
              fontSize: 14,
              color: theme.colors.ink,
            }}
          >
            {name}
          </Text>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 10.5,
              color: theme.colors.accent,
              marginTop: 1,
            }}
          >
            {theme.decorate ? "● в сети" : "в сети"}
          </Text>
        </View>
        <IconBtn>
          {/* TODO: hook up to call flow in step 5 */}
          <PhoneIcon color={theme.colors.ink} />
        </IconBtn>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
        <DateDivider text="сегодня" />
        {WERFIRE_THREAD.map((m, i) => (
          <Bubble key={i} mine={m.from === "me"} text={m.text} ts={m.ts} status={m.status} />
        ))}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Composer value={draft} onChangeText={setDraft} />
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function DateDivider({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: 8 }}>
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 10,
          color: theme.colors.inkMuted,
          letterSpacing: 1.2,
        }}
      >
        {theme.decorate ? `// ${text.toUpperCase()}` : text}
      </Text>
    </View>
  );
}

function Composer({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.bg,
      }}
    >
      <Pressable
        style={{
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.bgElev,
        }}
      >
        <Text style={{ color: theme.colors.accent, fontSize: 20, fontWeight: "700" }}>+</Text>
      </Pressable>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.bgInput,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingHorizontal: 12,
          paddingVertical: 8,
          maxHeight: 120,
        }}
      >
        <TextInput
          multiline
          value={value}
          onChangeText={onChangeText}
          placeholder={theme.decorate ? "> сообщение_" : "Сообщение"}
          placeholderTextColor={theme.colors.inkMuted}
          style={{
            color: theme.colors.ink,
            fontFamily: theme.fonts.body,
            fontSize: 14,
            padding: 0,
          }}
        />
      </View>
      <Pressable
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radius.md,
          backgroundColor: value.trim() ? theme.colors.accent : theme.colors.bgElev,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <SendIcon color={value.trim() ? theme.colors.accentText : theme.colors.inkMuted} />
      </Pressable>
    </View>
  );
}
