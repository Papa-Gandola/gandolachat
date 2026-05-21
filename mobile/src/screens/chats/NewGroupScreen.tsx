import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { NeoButton } from "../../components/NeoButton";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { apiErrorMessage, chatApi, userApi, UserOut } from "../../services/api";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "NewGroup">;

const PALETTE = ["#ef5350", "#7c4dff", "#ffa726", "#26a69a", "#ec407a", "#5c6bc0", "#ff7043", "#3949ab", "#66bb6a"];
const colorFor = (id: number) => PALETTE[id % PALETTE.length];
// Server caps groups at 7 incl. the creator, so up to 6 others.
const MAX_MEMBERS = 6;

export function NewGroupScreen({ navigation }: Props) {
  const theme = useTheme();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserOut[]>([]);
  const [selected, setSelected] = useState<UserOut[]>([]);
  const [allowAllWrite, setAllowAllWrite] = useState(true);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await userApi.search(q);
        setResults(res.data);
        setError(null);
      } catch (err) {
        setError(apiErrorMessage(err));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const isSelected = (id: number) => selected.some((u) => u.id === id);

  const toggle = (u: UserOut) => {
    setSelected((prev) => {
      if (prev.some((x) => x.id === u.id)) return prev.filter((x) => x.id !== u.id);
      if (prev.length >= MAX_MEMBERS) return prev;
      return [...prev, u];
    });
  };

  const create = async () => {
    const n = name.trim();
    if (!n || selected.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await chatApi.createGroup(n, selected.map((u) => u.id), allowAllWrite);
      const chat = res.data;
      navigation.replace("GroupChat", { chatId: String(chat.id), name: chat.name ?? n });
    } catch (err) {
      setError(apiErrorMessage(err));
      setCreating(false);
    }
  };

  const canCreate = name.trim().length > 0 && selected.length > 0 && !creating;
  const q = query.trim();

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? "// НОВАЯ ГРУППА" : "Новая группа"}
        left={
          <IconBtn onPress={() => navigation.goBack()}>
            <ChevronLeftIcon color={theme.colors.ink} />
          </IconBtn>
        }
      />

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        {/* Group name */}
        <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
          <View
            style={{
              backgroundColor: theme.colors.bgInput,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: name ? theme.colors.borderStrong : theme.colors.border,
              paddingHorizontal: 12,
              paddingVertical: 11,
            }}
          >
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={100}
              placeholder={theme.decorate ? "название группы..." : "Название группы"}
              placeholderTextColor={theme.colors.inkMuted}
              style={{ color: theme.colors.ink, fontFamily: theme.fonts.mono, fontSize: 15, padding: 0 }}
            />
          </View>
        </View>

        {/* Channel toggle */}
        <Pressable
          onPress={() => setAllowAllWrite((v) => !v)}
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 14, paddingVertical: 14 }}
        >
          <View
            style={{
              width: 18,
              height: 18,
              marginTop: 1,
              borderRadius: theme.radius.sm,
              borderWidth: 1.5,
              borderColor: theme.colors.accent,
              backgroundColor: allowAllWrite ? theme.colors.accent : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {allowAllWrite ? (
              <Text style={{ color: theme.colors.accentText, fontSize: 11, fontWeight: "800" }}>✓</Text>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.ink }}>
              {theme.decorate ? "// писать могут все" : "Писать могут все"}
            </Text>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted, marginTop: 2 }}>
              {allowAllWrite
                ? "обычная группа — пишут все участники"
                : "канал — пишет только создатель, остальные читают"}
            </Text>
          </View>
        </Pressable>

        {/* Selected chips */}
        {selected.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 14, paddingBottom: 8 }}>
            {selected.map((u) => (
              <Pressable
                key={u.id}
                onPress={() => toggle(u)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingVertical: 4,
                  paddingHorizontal: 8,
                  borderRadius: theme.radius.sm,
                  backgroundColor: theme.colors.accent,
                }}
              >
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: theme.colors.accentText }}>
                  {u.username}
                </Text>
                <Text style={{ color: theme.colors.accentText, fontSize: 13, fontWeight: "800" }}>×</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Member search */}
        <View style={{ paddingHorizontal: 14, paddingTop: 4, paddingBottom: 6 }}>
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
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              placeholder={theme.decorate ? "добавить участников..." : "Добавить участников…"}
              placeholderTextColor={theme.colors.inkMuted}
              style={{ flex: 1, color: theme.colors.ink, fontFamily: theme.fonts.mono, fontSize: 14, padding: 0 }}
            />
            {loading ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
          </View>
          {selected.length >= MAX_MEMBERS ? (
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.amber, marginTop: 6 }}>
              {theme.decorate ? "// максимум 7 участников (включая тебя)" : "Максимум 7 участников (включая тебя)"}
            </Text>
          ) : null}
        </View>

        {error ? (
          <Text style={{ fontFamily: theme.fonts.mono, color: theme.colors.danger, fontSize: 12, textAlign: "center", paddingVertical: 12 }}>
            {theme.decorate ? `! ${error}` : error}
          </Text>
        ) : null}

        {results.map((u) => {
          const sel = isSelected(u.id);
          const atCap = !sel && selected.length >= MAX_MEMBERS;
          return (
            <Pressable
              key={u.id}
              onPress={() => toggle(u)}
              disabled={atCap}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
                backgroundColor: pressed ? theme.colors.bgElev : "transparent",
                opacity: atCap ? 0.4 : 1,
              })}
            >
              <Avatar letter={(u.username[0] ?? "?").toUpperCase()} size={40} bg={colorFor(u.id)} uri={u.avatar_url} />
              <Text style={{ flex: 1, fontFamily: theme.fonts.mono, fontSize: 14, color: theme.colors.ink }}>
                {theme.decorate ? `@${u.username}` : u.username}
              </Text>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: theme.id === "neo" ? 4 : 11,
                  borderWidth: 1.5,
                  borderColor: sel ? theme.colors.accent : theme.colors.border,
                  backgroundColor: sel ? theme.colors.accent : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {sel ? <Text style={{ color: theme.colors.accentText, fontSize: 12, fontWeight: "800" }}>✓</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
        <NeoButton onPress={create} disabled={!canCreate}>
          {creating
            ? "СОЗДАНИЕ..."
            : selected.length > 0
              ? `СОЗДАТЬ · ${selected.length + 1}`
              : "СОЗДАТЬ"}
        </NeoButton>
      </View>
    </ScreenContainer>
  );
}
