import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { apiErrorMessage, chatApi } from "../../services/api";
import { API_URL } from "../../services/config";
import { useAuth } from "../../services/AuthContext";
import { useMessages } from "../../services/useMessages";
import { wsService } from "../../services/ws";
import { useTheme } from "../../theme";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic)$/i;

function isImage(url: string | null | undefined): boolean {
  return !!url && IMAGE_EXT.test(url);
}

function fileUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

type Props = NativeStackScreenProps<ChatsStackParamList, "Chat">;

export function ChatScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const { user } = useAuth();
  const { chatId, name, userId, avatarUrl } = route.params;
  const { messages, loading, error } = useMessages(chatId);
  const scrollRef = useRef<ScrollView | null>(null);
  const [draft, setDraft] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reactionFor, setReactionFor] = useState<number | null>(null);
  // Highest message id the OTHER side has read — drives the ✓✓ indicator on
  // my own bubbles.
  const [peerLastRead, setPeerLastRead] = useState(0);

  // Auto-scroll to bottom when new messages arrive — simple "messenger feel"
  // and matches the desktop behaviour. setTimeout(0) lets layout settle.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(t);
  }, [messages.length]);

  // Read receipts: fetch who's read what, then keep it live via WS.
  useEffect(() => {
    const numericId = Number(chatId);
    chatApi
      .getReadStatus(numericId)
      .then((res) => {
        const maxRead = res.data
          .filter((r) => r.user_id !== user?.id)
          .reduce((mx, r) => Math.max(mx, r.last_read_message_id ?? 0), 0);
        setPeerLastRead(maxRead);
      })
      .catch(() => {});
    const onRead = (d: Record<string, unknown>) => {
      if ((d.chat_id as number) !== numericId) return;
      if ((d.user_id as number) === user?.id) return;
      const last = d.last_read_message_id as number | undefined;
      if (typeof last === "number") setPeerLastRead((prev) => Math.max(prev, last));
    };
    wsService.on("message_read", onRead);
    return () => wsService.off("message_read", onRead);
  }, [chatId, user?.id]);

  // Mark the newest message as read so the peer sees our ✓✓ and our unread
  // badge clears. Fires whenever the latest message changes.
  useEffect(() => {
    if (messages.length === 0) return;
    const latest = messages[messages.length - 1];
    wsService.send({ type: "mark_read", chat_id: Number(chatId), message_id: latest.id });
  }, [chatId, messages]);

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

  const doUpload = async (file: { uri: string; name: string; type: string }) => {
    setAttachOpen(false);
    setUploading(true);
    try {
      // The server broadcasts the resulting message over WS, so useMessages
      // appends it — no need to use the response here.
      await chatApi.uploadFile(Number(chatId), file, draft.trim());
      setDraft("");
    } catch (err) {
      Alert.alert("Не удалось отправить", apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const pickPhoto = async () => {
    setAttachOpen(false);
    try {
      // No permission gate here — the system photo picker doesn't need
      // READ_MEDIA on Android 13+, and requesting it can silently deny.
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      await doUpload({
        uri: a.uri,
        name: a.fileName ?? `photo_${Date.now()}.jpg`,
        type: a.mimeType ?? "image/jpeg",
      });
    } catch (err) {
      Alert.alert("Галерея недоступна", apiErrorMessage(err));
    }
  };

  const takePhoto = async () => {
    setAttachOpen(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Нет доступа к камере", "Разреши доступ к камере в настройках Android.");
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      await doUpload({
        uri: a.uri,
        name: a.fileName ?? `camera_${Date.now()}.jpg`,
        type: a.mimeType ?? "image/jpeg",
      });
    } catch (err) {
      Alert.alert("Камера недоступна", apiErrorMessage(err));
    }
  };

  // Toggle my reaction: if I already reacted with this emoji, remove it; else add.
  const toggleReaction = (messageId: number, emoji: string) => {
    const msg = messages.find((m) => m.id === messageId);
    const mineAlready = msg?.reactions?.some((r) => r.emoji === emoji && r.user_id === user?.id);
    wsService.send({
      type: mineAlready ? "remove_reaction" : "reaction",
      message_id: messageId,
      emoji,
      chat_id: Number(chatId),
    });
  };

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    await doUpload({
      uri: a.uri,
      name: a.name ?? `file_${Date.now()}`,
      type: a.mimeType ?? "application/octet-stream",
    });
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
        <Pressable
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
          disabled={userId == null}
          onPress={() => userId != null && navigation.navigate("OtherProfile", { userId })}
        >
          <Avatar letter={(name[0] ?? "?").toUpperCase()} size={36} bg="#ef5350" uri={avatarUrl} />
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
        </Pressable>
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
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          const img = isImage(m.file_url) ? fileUrl(m.file_url) : null;
          const text = m.content ?? (m.file_url && !img ? `📎 ${m.file_name ?? "файл"}` : "");
          return (
            <Pressable key={m.id} onLongPress={() => setReactionFor(m.id)} delayLongPress={250}>
              <Bubble
                mine={mine}
                text={text}
                imageUri={img}
                onPressImage={() => img && navigation.navigate("MediaViewer", { url: img })}
                ts={formatTs(m.created_at)}
                status={mine ? (peerLastRead >= m.id ? "read" : "delivered") : undefined}
              >
                <ReactionChips
                  reactions={m.reactions ?? []}
                  myId={user?.id}
                  onToggle={(emoji) => toggleReaction(m.id, emoji)}
                  theme={theme}
                />
              </Bubble>
              {reactionFor === m.id ? (
                <ReactionPicker
                  mine={mine}
                  theme={theme}
                  onPick={(emoji) => {
                    toggleReaction(m.id, emoji);
                    setReactionFor(null);
                  }}
                />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {attachOpen ? (
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              backgroundColor: theme.colors.bgElev,
            }}
          >
            <AttachOption label="Фото" onPress={pickPhoto} theme={theme} />
            <AttachOption label="Камера" onPress={takePhoto} theme={theme} />
            <AttachOption label="Файл" onPress={pickFile} theme={theme} />
          </View>
        ) : null}
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
            onPress={() => setAttachOpen((v) => !v)}
            disabled={uploading}
            style={{
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.bgElev,
            }}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            ) : (
              <Text style={{ color: theme.colors.accent, fontSize: 20, fontWeight: "700" }}>
                {attachOpen ? "×" : "+"}
              </Text>
            )}
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

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🔥", "😮", "😢"];

type ThemeT = ReturnType<typeof useTheme>;

function ReactionChips({
  reactions,
  myId,
  onToggle,
  theme,
}: {
  reactions: Array<{ emoji: string; user_id: number }>;
  myId: number | undefined;
  onToggle: (emoji: string) => void;
  theme: ThemeT;
}) {
  if (reactions.length === 0) return null;
  // Aggregate by emoji → count + whether I'm in it.
  const groups = new Map<string, { count: number; mine: boolean }>();
  reactions.forEach((r) => {
    const g = groups.get(r.emoji) ?? { count: 0, mine: false };
    g.count += 1;
    if (r.user_id === myId) g.mine = true;
    groups.set(r.emoji, g);
  });
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      {[...groups.entries()].map(([emoji, g]) => (
        <Pressable
          key={emoji}
          onPress={() => onToggle(emoji)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 3,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 10,
            backgroundColor: g.mine ? theme.colors.accent + "33" : "rgba(0,0,0,0.18)",
            borderWidth: 1,
            borderColor: g.mine ? theme.colors.accent : "transparent",
          }}
        >
          <Text style={{ fontSize: 12 }}>{emoji}</Text>
          <Text style={{ fontSize: 11, color: theme.colors.ink, fontFamily: theme.fonts.mono }}>
            {g.count}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function ReactionPicker({
  mine,
  theme,
  onPick,
}: {
  mine: boolean;
  theme: ThemeT;
  onPick: (emoji: string) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 6,
        alignSelf: mine ? "flex-end" : "flex-start",
        marginHorizontal: 14,
        marginTop: 2,
        marginBottom: 4,
        paddingHorizontal: 8,
        paddingVertical: 6,
        backgroundColor: theme.colors.bgElevH,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 20,
      }}
    >
      {QUICK_EMOJIS.map((e) => (
        <Pressable key={e} onPress={() => onPick(e)} hitSlop={6}>
          <Text style={{ fontSize: 22 }}>{e}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function AttachOption({
  label,
  onPress,
  theme,
}: {
  label: string;
  onPress: () => void;
  theme: ThemeT;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 12,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.bg,
        alignItems: "center",
      }}
    >
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.ink, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
}
