import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Audio } from "expo-av";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
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
import { VoiceMessage } from "../../components/VoiceMessage";
import { ChatsStackParamList } from "../../navigation/types";
import { apiErrorMessage, chatApi, userApi } from "../../services/api";
import { API_URL } from "../../services/config";
import { useAuth } from "../../services/AuthContext";
import { useMessages } from "../../services/useMessages";
import { wsService } from "../../services/ws";
import { useTheme } from "../../theme";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic)$/i;
const AUDIO_EXT = /\.(m4a|mp3|aac|wav|ogg|opus|caf)$/i;

function isImage(url: string | null | undefined): boolean {
  return !!url && IMAGE_EXT.test(url);
}

function isAudio(url: string | null | undefined): boolean {
  return !!url && AUDIO_EXT.test(url);
}

function fileUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

// Module-level handle to the most recent recording. expo-av allows only one
// prepared recording globally, so if one leaks (component re-render, fast
// taps) we can force-unload it before starting the next.
let lastRecording: Audio.Recording | null = null;

// Some Android devices never release expo-av's single global recorder after
// stopAndUnloadAsync(), so the next prepareToRecordAsync rejects with "Only one
// Recording object can be prepared at a given time" (after a long native stall)
// and stays wedged until the app process is killed. Toggling the whole audio
// subsystem off→on force-releases the stuck native recorder without a restart.
async function resetAudioSubsystem() {
  try {
    await Audio.setIsEnabledAsync(false);
    await new Promise((r) => setTimeout(r, 250));
    await Audio.setIsEnabledAsync(true);
  } catch {
    // best-effort — nothing more we can do from JS
  }
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
  const recordingRef = useRef<Audio.Recording | null>(null);
  // True while a recording is being created or torn down — expo-av allows only
  // one prepared recording at a time, so block a new start until teardown ends.
  const recBusyRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const recStartRef = useRef(0);
  // Highest message id the OTHER side has read — drives the ✓✓ indicator on
  // my own bubbles.
  const [peerLastRead, setPeerLastRead] = useState(0);
  // Peer presence for the header subtitle (DM only).
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerLastSeen, setPeerLastSeen] = useState<string | null>(null);

  // Auto-scroll to bottom when new messages arrive — simple "messenger feel"
  // and matches the desktop behaviour. setTimeout(0) lets layout settle.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(t);
  }, [messages.length]);

  // Discard any in-progress recording if the screen unmounts mid-record.
  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    };
  }, []);

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

  // Peer presence (DM only): seed from REST, then track live via WS.
  useEffect(() => {
    if (userId == null) return;
    chatApi
      .getOnlineUsers()
      .then((res) => setPeerOnline(res.data.online_user_ids.includes(userId)))
      .catch(() => {});
    userApi
      .getUser(userId)
      .then((res) => setPeerLastSeen(res.data.last_seen ?? null))
      .catch(() => {});
    const onOnline = (d: Record<string, unknown>) => {
      if ((d.user_id as number) === userId) setPeerOnline(true);
    };
    const onOffline = (d: Record<string, unknown>) => {
      if ((d.user_id as number) === userId) {
        setPeerOnline(false);
        if (typeof d.last_seen === "string") setPeerLastSeen(d.last_seen);
      }
    };
    wsService.on("user_online", onOnline);
    wsService.on("user_offline", onOffline);
    return () => {
      wsService.off("user_online", onOnline);
      wsService.off("user_offline", onOffline);
    };
  }, [userId]);

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

  const takePhoto = () => {
    // Open the in-app camera (instant) instead of the slow system intent.
    setAttachOpen(false);
    navigation.navigate("Camera", { chatId });
  };

  const startRecording = async () => {
    if (recBusyRef.current || recordingRef.current) return;
    recBusyRef.current = true;
    setRecError(null);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setRecError("Нет доступа к микрофону — разреши его в настройках Android.");
        return;
      }
      // Force-release any recorder leaked from a previous attempt (ref cleared
      // but native object not unloaded) — otherwise prepare throws "Only one
      // recording object can be prepared at a given time".
      if (lastRecording) {
        try {
          await lastRecording.stopAndUnloadAsync();
        } catch {
          // already gone
        }
        lastRecording = null;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      // Manual prepare → start (createAsync misbehaved on some devices). Hold
      // the ref BEFORE start so the object can't be garbage-collected.
      const rec = new Audio.Recording();
      try {
        await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      } catch {
        // Previous recorder still held by the OS — force-release the whole audio
        // subsystem (toggling the iOS audio-mode flag alone does nothing on
        // Android) and retry once.
        await resetAudioSubsystem();
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      }
      lastRecording = rec;
      recordingRef.current = rec;
      await rec.startAsync();
      recStartRef.current = Date.now();
      setRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (err) {
      recordingRef.current = null;
      lastRecording = null;
      setRecError(err instanceof Error ? err.message : String(err));
    } finally {
      recBusyRef.current = false;
    }
  };

  const stopRecording = async (send: boolean) => {
    const rec = recordingRef.current;
    if (!rec || recBusyRef.current) return;
    // Block any new start until this recording is fully unloaded (expo-av only
    // allows one prepared recording at a time).
    recBusyRef.current = true;
    recordingRef.current = null;
    setRecording(false);
    let uri: string | null = null;
    let tooShort = true;
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      uri = rec.getURI();
      tooShort = Date.now() - recStartRef.current < 800;
    } catch (err) {
      setRecError(err instanceof Error ? err.message : String(err));
    } finally {
      lastRecording = null;
      // Proactively release the native recorder so the NEXT recording starts
      // from a clean audio session — without this, some Android devices let you
      // record exactly once per app launch.
      await resetAudioSubsystem();
      recBusyRef.current = false;
    }
    if (send && !tooShort && uri) {
      await doUpload({ uri, name: `voice_${Date.now()}.m4a`, type: "audio/m4a" });
    }
  };

  const copyMessage = async (text: string) => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setReactionFor(null);
  };

  // Toggle my reaction: if I already reacted with this emoji, remove it; else add.
  const toggleReaction = (messageId: number, emoji: string) => {
    Haptics.selectionAsync().catch(() => {});
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
            {userId != null ? (
              <Text
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: 10.5,
                  color: peerOnline ? theme.colors.online : theme.colors.inkMuted,
                  marginTop: 1,
                }}
              >
                {peerOnline
                  ? theme.decorate
                    ? "● в сети"
                    : "в сети"
                  : `был(а) ${formatLastSeen(peerLastSeen)}`}
              </Text>
            ) : null}
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
          const audio = isAudio(m.file_url) ? fileUrl(m.file_url) : null;
          const img = !audio && isImage(m.file_url) ? fileUrl(m.file_url) : null;
          const text = m.content ?? (m.file_url && !img && !audio ? `📎 ${m.file_name ?? "файл"}` : "");
          return (
            <Pressable
              key={m.id}
              onLongPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setReactionFor(m.id);
              }}
              delayLongPress={250}
            >
              <Bubble
                mine={mine}
                text={text}
                imageUri={img}
                media={audio ? <VoiceMessage uri={audio} mine={mine} /> : undefined}
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
                  canCopy={!!m.content}
                  onCopy={() => copyMessage(m.content ?? "")}
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
        {recError ? (
          <Pressable
            onPress={() => setRecError(null)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              backgroundColor: theme.colors.danger + "22",
              borderTopWidth: 1,
              borderTopColor: theme.colors.danger,
            }}
          >
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.danger }}>
              микрофон: {recError} (нажми чтобы скрыть)
            </Text>
          </Pressable>
        ) : null}
        {recording ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 8,
              backgroundColor: theme.colors.danger + "22",
              borderTopWidth: 1,
              borderTopColor: theme.colors.danger,
            }}
          >
            <View
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.danger }}
            />
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.ink }}>
              Идёт запись… ➤ отправить · ✕ отмена
            </Text>
          </View>
        ) : null}
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
          {recording ? (
            <>
              <Pressable
                onPress={() => stopRecording(false)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.bgElev,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: theme.colors.danger, fontSize: 18, fontWeight: "700" }}>×</Text>
              </Pressable>
              <Pressable
                onPress={() => stopRecording(true)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accent,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <SendIcon color={theme.colors.accentText} />
              </Pressable>
            </>
          ) : draft.trim() ? (
            <Pressable
              onPress={send}
              style={{
                width: 40,
                height: 40,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.accent,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SendIcon color={theme.colors.accentText} />
            </Pressable>
          ) : (
            <Pressable
              onPress={startRecording}
              style={{
                width: 40,
                height: 40,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.bgElev,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 18 }}>🎤</Text>
            </Pressable>
          )}
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

function formatLastSeen(iso: string | null): string {
  if (!iso) return "давно";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "давно";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} дн назад`;
  return `${d.getDate()}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
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
  canCopy,
  onCopy,
}: {
  mine: boolean;
  theme: ThemeT;
  onPick: (emoji: string) => void;
  canCopy?: boolean;
  onCopy?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
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
      {canCopy && onCopy ? (
        <Pressable
          onPress={onCopy}
          hitSlop={6}
          style={{
            marginLeft: 4,
            paddingLeft: 8,
            borderLeftWidth: 1,
            borderLeftColor: theme.colors.border,
          }}
        >
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.accent }}>
            копир.
          </Text>
        </Pressable>
      ) : null}
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
