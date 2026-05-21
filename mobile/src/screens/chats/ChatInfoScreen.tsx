import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { ScreenContainer } from "../../components/ScreenContainer";
import { Section } from "../../components/Section";
import { ChatsStackParamList } from "../../navigation/types";
import { apiErrorMessage, ChatOut, ChatStats, chatApi, userApi, UserOut } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { wsService } from "../../services/ws";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "ChatInfo">;
type ThemeT = ReturnType<typeof useTheme>;

const PALETTE = ["#ef5350", "#7c4dff", "#ffa726", "#26a69a", "#ec407a", "#5c6bc0", "#ff7043", "#3949ab", "#66bb6a"];
const colorFor = (id: number) => PALETTE[id % PALETTE.length];
const MAX_MEMBERS = 7;

export function ChatInfoScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const { user } = useAuth();
  const numericId = Number(route.params.chatId);

  const [chat, setChat] = useState<ChatOut | null>(null);
  const [stats, setStats] = useState<ChatStats>({ media_count: 0, link_count: 0, file_count: 0 });
  const [online, setOnline] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserOut[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editName, setEditName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editDesc, setEditDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await chatApi.list();
      setChat(res.data.find((c) => c.id === numericId) ?? null);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [numericId]);

  useEffect(() => {
    refresh();
    chatApi.stats(numericId).then((r) => setStats(r.data)).catch(() => {});
    chatApi.getOnlineUsers().then((r) => setOnline(new Set(r.data.online_user_ids))).catch(() => {});
    const onUpdated = (d: Record<string, unknown>) => {
      const c = d.chat as ChatOut | undefined;
      if (c && c.id === numericId) setChat(c);
    };
    wsService.on("chat_updated", onUpdated);
    return () => wsService.off("chat_updated", onUpdated);
  }, [numericId, refresh]);

  // Member-add search (debounced), excluding existing members.
  useEffect(() => {
    if (!adding) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await userApi.search(q.trim());
        setResults(r.data.filter((u) => !chat?.members.some((m) => m.id === u.id)));
      } catch {
        // ignore
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, adding, chat]);

  if (loading) {
    return (
      <ScreenContainer>
        <AppBar title={theme.decorate ? "// ИНФО О ЧАТЕ" : "Информация о чате"} left={<BackBtn theme={theme} onPress={() => navigation.goBack()} />} />
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      </ScreenContainer>
    );
  }
  if (!chat) {
    return (
      <ScreenContainer>
        <AppBar title={theme.decorate ? "// ИНФО О ЧАТЕ" : "Информация о чате"} left={<BackBtn theme={theme} onPress={() => navigation.goBack()} />} />
        <Text style={{ fontFamily: theme.fonts.mono, color: theme.colors.danger, fontSize: 13, textAlign: "center", paddingVertical: 40 }}>
          {error ?? "Чат не найден"}
        </Text>
      </ScreenContainer>
    );
  }

  const isOwner = chat.created_by === user?.id;
  const admins = chat.admin_ids ?? [];
  const isAdmin = isOwner || admins.includes(user?.id ?? -1);
  const memberCount = chat.members.length;
  const onlineCount = chat.members.filter((m) => online.has(m.id)).length;

  const pickAvatar = async () => {
    if (!isOwner) return;
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      const updated = await chatApi.uploadGroupAvatar(numericId, {
        uri: a.uri,
        name: a.fileName ?? `group_${Date.now()}.jpg`,
        type: a.mimeType ?? "image/jpeg",
      });
      setChat(updated);
    } catch (e) {
      Alert.alert("Не удалось", apiErrorMessage(e));
    }
  };

  const saveName = async () => {
    if (!nameDraft.trim()) {
      setEditName(false);
      return;
    }
    try {
      await chatApi.update(numericId, { name: nameDraft.trim() });
      refresh();
    } catch (e) {
      Alert.alert("Не удалось", apiErrorMessage(e));
    }
    setEditName(false);
  };

  const saveDesc = async () => {
    try {
      await chatApi.update(numericId, { description: descDraft.trim() });
      refresh();
    } catch (e) {
      Alert.alert("Не удалось", apiErrorMessage(e));
    }
    setEditDesc(false);
  };

  const toggleAdmin = async (uid: number) => {
    if (!isOwner) return;
    const set = new Set(admins);
    if (set.has(uid)) set.delete(uid);
    else set.add(uid);
    try {
      await chatApi.update(numericId, { admin_ids: [...set] });
      refresh();
    } catch (e) {
      Alert.alert("Не удалось", apiErrorMessage(e));
    }
  };

  const kick = (uid: number) => {
    Alert.alert("Удалить участника?", "Он больше не сможет писать в группу.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await chatApi.kickMember(numericId, uid);
            refresh();
          } catch (e) {
            Alert.alert("Не удалось", apiErrorMessage(e));
          }
        },
      },
    ]);
  };

  const addMember = async (u: UserOut) => {
    try {
      await chatApi.addMember(numericId, u.id);
      setQ("");
      setResults([]);
      setAdding(false);
      refresh();
    } catch (e) {
      Alert.alert("Не удалось", apiErrorMessage(e));
    }
  };

  const leave = () => {
    Alert.alert("Покинуть группу?", "", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Покинуть",
        style: "destructive",
        onPress: async () => {
          try {
            await chatApi.leaveChat(numericId);
            navigation.popToTop();
          } catch (e) {
            Alert.alert("Не удалось", apiErrorMessage(e));
          }
        },
      },
    ]);
  };

  const del = () => {
    Alert.alert("Удалить группу?", "Это действие необратимо.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await chatApi.deleteChat(numericId);
            navigation.popToTop();
          } catch (e) {
            Alert.alert("Не удалось", apiErrorMessage(e));
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <AppBar title={theme.decorate ? "// ИНФО О ЧАТЕ" : "Информация о чате"} left={<BackBtn theme={theme} onPress={() => navigation.goBack()} />} />
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        {/* Avatar + name */}
        <View style={{ alignItems: "center", paddingVertical: 18 }}>
          <Pressable onPress={pickAvatar} disabled={!isOwner}>
            <Avatar letter={(chat.name?.[0] ?? "#").toUpperCase()} size={104} bg={colorFor(chat.id)} uri={chat.avatar_url} square />
            {isOwner ? (
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.accent, textAlign: "center", marginTop: 8 }}>
                {theme.decorate ? "[сменить]" : "Сменить"}
              </Text>
            ) : null}
          </Pressable>

          {editName ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 12, paddingHorizontal: 16 }}>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                autoFocus
                maxLength={100}
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: 18,
                  fontWeight: "700",
                  color: theme.colors.ink,
                  backgroundColor: theme.colors.bgInput,
                  borderWidth: 1,
                  borderColor: theme.colors.accent,
                  borderRadius: theme.radius.sm,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  minWidth: 160,
                  textAlign: "center",
                }}
              />
              <Pressable onPress={saveName} style={{ padding: 8, borderRadius: theme.radius.sm, backgroundColor: theme.colors.accent }}>
                <Text style={{ color: theme.colors.accentText, fontWeight: "800" }}>✓</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => isOwner && (setNameDraft(chat.name ?? ""), setEditName(true))} disabled={!isOwner}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 20, fontWeight: "700", color: theme.colors.ink, marginTop: 12 }}>
                {chat.name || "Без названия"}
              </Text>
            </Pressable>
          )}
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkDim, marginTop: 4 }}>
            {memberCount} участников · {onlineCount} в сети
          </Text>
        </View>

        {/* Description */}
        <Section>ОПИСАНИЕ</Section>
        {editDesc ? (
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <TextInput
              value={descDraft}
              onChangeText={setDescDraft}
              autoFocus
              multiline
              maxLength={1000}
              style={{
                fontFamily: theme.fonts.body,
                fontSize: 14,
                color: theme.colors.ink,
                backgroundColor: theme.colors.bgInput,
                borderWidth: 1,
                borderColor: theme.colors.accent,
                borderRadius: theme.radius.sm,
                paddingHorizontal: 10,
                paddingVertical: 8,
                minHeight: 70,
              }}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={saveDesc} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: theme.radius.sm, backgroundColor: theme.colors.accent }}>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: theme.colors.accentText }}>
                  {theme.decorate ? "[сохранить]" : "Сохранить"}
                </Text>
              </Pressable>
              <Pressable onPress={() => setEditDesc(false)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border }}>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkDim }}>
                  {theme.decorate ? "[отмена]" : "Отмена"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => isOwner && (setDescDraft(chat.description ?? ""), setEditDesc(true))}
            disabled={!isOwner}
            style={{ paddingHorizontal: 16, paddingBottom: 8 }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.body,
                fontSize: 14,
                color: chat.description ? theme.colors.inkDim : theme.colors.inkMuted,
                fontStyle: chat.description ? "normal" : "italic",
                lineHeight: 20,
              }}
            >
              {chat.description || (isOwner ? "Добавь описание группы…" : "Описание не задано")}
            </Text>
          </Pressable>
        )}

        {/* Stats */}
        <Section>МЕДИА · ССЫЛКИ · ФАЙЛЫ</Section>
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingBottom: 8 }}>
          <StatCard theme={theme} value={stats.media_count} label="МЕДИА" />
          <StatCard theme={theme} value={stats.link_count} label="ССЫЛОК" />
          <StatCard theme={theme} value={stats.file_count} label="ФАЙЛОВ" />
        </View>

        {/* Members */}
        <Section right={
          isAdmin && memberCount < MAX_MEMBERS ? (
            <Pressable onPress={() => setAdding((v) => !v)}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: theme.colors.accent }}>
                {adding ? (theme.decorate ? "[× закрыть]" : "× Закрыть") : theme.decorate ? "[+ добавить]" : "+ Добавить"}
              </Text>
            </Pressable>
          ) : undefined
        }>
          {`УЧАСТНИКИ · ${memberCount}`}
        </Section>

        {adding ? (
          <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              autoFocus
              autoCapitalize="none"
              placeholder={theme.decorate ? "найти пользователя..." : "Найти пользователя…"}
              placeholderTextColor={theme.colors.inkMuted}
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 14,
                color: theme.colors.ink,
                backgroundColor: theme.colors.bgInput,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                paddingHorizontal: 12,
                paddingVertical: 9,
              }}
            />
            {results.map((u) => (
              <Pressable
                key={u.id}
                onPress={() => addMember(u)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}
              >
                <Avatar letter={(u.username[0] ?? "?").toUpperCase()} size={32} bg={colorFor(u.id)} uri={u.avatar_url} />
                <Text style={{ flex: 1, fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.ink }}>{u.username}</Text>
                <Text style={{ color: theme.colors.accent, fontSize: 18, fontWeight: "700" }}>+</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {chat.members.map((m) => {
          const role = m.id === chat.created_by ? "OWNER" : admins.includes(m.id) ? "ADMIN" : null;
          const isOnline = online.has(m.id);
          const canKick = isAdmin && m.id !== chat.created_by && m.id !== user?.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => m.id !== user?.id && navigation.navigate("OtherProfile", { userId: m.id })}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9 }}
            >
              <View>
                <Avatar letter={(m.username[0] ?? "?").toUpperCase()} size={38} bg={colorFor(m.id)} uri={m.avatar_url} online={isOnline} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 14, fontWeight: "600", color: theme.colors.ink }}>{m.username}</Text>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: isOnline ? theme.colors.online : theme.colors.inkMuted }}>
                  {isOnline ? "в сети" : "оффлайн"}
                </Text>
              </View>
              {role ? (
                <Text
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: 9,
                    fontWeight: "700",
                    letterSpacing: 1,
                    paddingHorizontal: 6,
                    paddingVertical: 3,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.sm,
                    color: role === "OWNER" ? theme.colors.accent : theme.colors.ink,
                  }}
                >
                  {role}
                </Text>
              ) : null}
              {isOwner && m.id !== chat.created_by ? (
                <Pressable
                  onPress={() => toggleAdmin(m.id)}
                  hitSlop={6}
                  style={{ paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm }}
                >
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkDim }}>
                    {admins.includes(m.id) ? "−" : "+"}
                  </Text>
                </Pressable>
              ) : null}
              {canKick ? (
                <Pressable onPress={() => kick(m.id)} hitSlop={6}>
                  <Text style={{ color: theme.colors.danger, fontSize: 16 }}>✕</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}

        {/* Leave / delete */}
        <View style={{ padding: 16, paddingTop: 24, gap: 10 }}>
          <Pressable onPress={leave} style={{ paddingVertical: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center" }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.ink }}>
              {theme.decorate ? "[покинуть группу]" : "Покинуть группу"}
            </Text>
          </Pressable>
          {isOwner ? (
            <Pressable onPress={del} style={{ paddingVertical: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.danger, alignItems: "center" }}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: "#fff" }}>
                {theme.decorate ? "[удалить группу]" : "Удалить группу"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function BackBtn({ theme, onPress }: { theme: ThemeT; onPress: () => void }) {
  return (
    <IconBtn onPress={onPress}>
      <ChevronLeftIcon color={theme.colors.ink} />
    </IconBtn>
  );
}

function StatCard({ theme, value, label }: { theme: ThemeT; value: number; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        padding: 12,
        backgroundColor: theme.colors.bgElev,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.sm,
      }}
    >
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 22, fontWeight: "700", color: theme.colors.ink }}>{value}</Text>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, color: theme.colors.inkMuted, letterSpacing: 1, marginTop: 2 }}>{label}</Text>
    </View>
  );
}
