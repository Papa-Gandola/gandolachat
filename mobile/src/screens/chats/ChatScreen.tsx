import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { useAuth } from "../../services/AuthContext";
import { useMessages } from "../../services/useMessages";
import { wsService } from "../../services/ws";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "Chat">;

export function ChatScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const { user } = useAuth();
  const { chatId, name } = route.params;
  const { messages, loading, error } = useMessages(chatId);
  const scrollRef = useRef<ScrollView | null>(null);
  const [draft, setDraft] = useState("");

  // Auto-scroll to bottom when new messages arrive — simple "messenger feel"
  // and matches the desktop behaviour. setTimeout(0) lets layout settle.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = () => {
    const content = draft.trim();
    if (!content) return;
    const ok = wsService.send({
      type: "message",
      chat_id: Number(chatId),
      content,
      _temp_id: `${Date.now()}-${Math.random()}`,
    });
    if (ok) setDraft("");
    // Server will echo the message back via WebSocket and useMessages will
    // pick it up. No optimistic insert in this iteration — keeps the code
    // small and the latency is already <100ms for the round-trip.
  };

  return (
    <ScreenContainer>
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
        <Avatar letter={(name[0] ?? "?").toUpperCase()} size={36} bg="#ef5350" />
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
        </View>
        <IconBtn>
          <PhoneIcon color={theme.colors.ink} />
        </IconBtn>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: 8 }}
      >
        {loading && messages.length === 0 ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : null}
        {error ? (
          <View style={{ padding: 24, alignItems: "center" }}>
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                color: theme.colors.danger,
                fontSize: 12,
                textAlign: "center",
              }}
            >
              {theme.decorate ? `! ${error}` : error}
            </Text>
          </View>
        ) : null}
        {messages.length === 0 && !loading && !error ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                color: theme.colors.inkMuted,
                fontSize: 11,
              }}
            >
              {theme.decorate ? "// пока пусто" : "Сообщений пока нет"}
            </Text>
          </View>
        ) : null}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            mine={m.sender_id === user?.id}
            text={m.content ?? (m.file_name ? `📎 ${m.file_name}` : "")}
            ts={formatTs(m.created_at)}
          />
        ))}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
              value={draft}
              onChangeText={setDraft}
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
            onPress={send}
            disabled={!draft.trim()}
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius.md,
              backgroundColor: draft.trim() ? theme.colors.accent : theme.colors.bgElev,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SendIcon color={draft.trim() ? theme.colors.accentText : theme.colors.inkMuted} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
