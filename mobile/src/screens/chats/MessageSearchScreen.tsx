import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { chatApi, MessageOut } from "../../services/api";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "MessageSearch">;

export function MessageSearchScreen({ navigation, route }: Props) {
  const { chatId, chatName } = route.params;
  const theme = useTheme();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MessageOut[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await chatApi.searchMessages(Number(chatId), text);
        setResults(res.data ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, chatId]);

  const goToMessage = (msgId: number) => {
    // Pass the target message back to ChatScreen via params; ChatScreen
    // listens on `scrollToTick` and highlights the matching message.
    navigation.navigate("Chat", {
      chatId,
      name: chatName,
      scrollToMessageId: msgId,
      scrollToTick: Date.now(),
    } as never);
  };

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? `// ПОИСК · ${chatName.toUpperCase()}` : `Поиск · ${chatName}`}
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
            borderColor: q ? theme.colors.borderStrong : theme.colors.border,
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
            placeholder={theme.decorate ? "найти сообщение..." : "Найти сообщение…"}
            placeholderTextColor={theme.colors.inkMuted}
            style={{ flex: 1, color: theme.colors.ink, fontFamily: theme.fonts.mono, fontSize: 14, padding: 0 }}
          />
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        {loading ? (
          <View style={{ paddingVertical: 24, alignItems: "center" }}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : q.trim().length < 2 ? (
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              color: theme.colors.inkMuted,
              fontSize: 12,
              textAlign: "center",
              paddingVertical: 40,
            }}
          >
            {theme.decorate ? "// введи минимум 2 символа" : "Введи минимум 2 символа"}
          </Text>
        ) : results.length === 0 ? (
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
        ) : (
          results.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => goToMessage(m.id)}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderBottomWidth: 0.5,
                borderBottomColor: theme.colors.border,
                backgroundColor: pressed ? theme.colors.bgHover : "transparent",
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.accent }}>
                  {m.sender_username}
                </Text>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted }}>
                  · {formatDate(m.created_at)}
                </Text>
              </View>
              <Text
                style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.ink, lineHeight: 18 }}
                numberOfLines={3}
              >
                {m.content || (m.file_url ? "📎 вложение" : "")}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hm = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")} ${hm}`;
}
