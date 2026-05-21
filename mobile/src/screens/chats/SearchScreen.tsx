import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { ChatRow } from "../../components/ChatRow";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { useChats } from "../../services/useChats";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "Search">;

export function SearchScreen({ navigation }: Props) {
  const theme = useTheme();
  const { chats } = useChats();
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const visible = query
    ? chats.filter(
        (c) => c.name.toLowerCase().includes(query) || (c.last ?? "").toLowerCase().includes(query),
      )
    : chats;

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? "// ПОИСК" : "Поиск"}
        left={
          <IconBtn onPress={() => navigation.goBack()}>
            <ChevronLeftIcon color={theme.colors.ink} />
          </IconBtn>
        }
      />

      <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 }}>
        <View
          style={{
            backgroundColor: theme.colors.bgInput,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: query ? theme.colors.borderStrong : theme.colors.border,
            paddingHorizontal: 12,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          {theme.decorate ? (
            <Text style={{ color: theme.colors.accent, fontFamily: theme.fonts.mono, fontSize: 13 }}>/</Text>
          ) : null}
          <TextInput
            value={q}
            onChangeText={setQ}
            autoFocus
            placeholder={theme.decorate ? "найти чат..." : "Найти чат…"}
            placeholderTextColor={theme.colors.inkMuted}
            style={{ flex: 1, color: theme.colors.ink, fontFamily: theme.fonts.mono, fontSize: 14, padding: 0 }}
          />
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        {visible.length === 0 ? (
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              color: theme.colors.inkMuted,
              fontSize: 12,
              textAlign: "center",
              paddingVertical: 40,
            }}
          >
            {theme.decorate ? "// ничего не найдено" : "Ничего не найдено"}
          </Text>
        ) : null}
        {visible.map((c) => (
          <ChatRow
            key={c.id}
            chat={c}
            onPress={() =>
              navigation.navigate(c.group ? "GroupChat" : "Chat", {
                chatId: c.id,
                name: c.name,
                userId: c.peerId,
                avatarUrl: c.avatarUrl,
                isGroup: c.group,
                allowAllWrite: c.allowAllWrite,
                createdBy: c.createdBy,
              })
            }
          />
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}
