import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { apiErrorMessage, chatApi, userApi, UserOut } from "../../services/api";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "NewChat">;

const PALETTE = ["#ef5350", "#7c4dff", "#ffa726", "#26a69a", "#ec407a", "#5c6bc0", "#ff7043", "#3949ab", "#66bb6a"];
const colorFor = (id: number) => PALETTE[id % PALETTE.length];

export function NewChatScreen({ navigation }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced server-side username search. <2 chars clears results (matches the
  // desktop sidebar behaviour).
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

  const openDm = async (u: UserOut) => {
    if (opening) return;
    setOpening(true);
    try {
      // Server returns the existing DM if one already exists, else creates it.
      const res = await chatApi.createDm(u.id);
      const chat = res.data;
      // replace() so Back from the chat returns to the list, not here.
      navigation.replace("Chat", {
        chatId: String(chat.id),
        name: u.username,
        userId: u.id,
        avatarUrl: u.avatar_url,
      });
    } catch (err) {
      setError(apiErrorMessage(err));
      setOpening(false);
    }
  };

  const q = query.trim();

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? "// НОВЫЙ ЧАТ" : "Новый чат"}
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
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            placeholder={theme.decorate ? "найти пользователя..." : "Найти пользователя…"}
            placeholderTextColor={theme.colors.inkMuted}
            style={{
              flex: 1,
              color: theme.colors.ink,
              fontFamily: theme.fonts.mono,
              fontSize: 14,
              padding: 0,
            }}
          />
          {loading ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={{ padding: 20, alignItems: "center" }}>
            <Text style={{ fontFamily: theme.fonts.mono, color: theme.colors.danger, fontSize: 12, textAlign: "center" }}>
              {theme.decorate ? `! ${error}` : error}
            </Text>
          </View>
        ) : null}

        {q.length < 2 && !error ? (
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
        ) : null}

        {q.length >= 2 && !loading && results.length === 0 && !error ? (
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              color: theme.colors.inkMuted,
              fontSize: 12,
              textAlign: "center",
              paddingVertical: 40,
            }}
          >
            {theme.decorate ? "// никого не найдено" : "Никого не найдено"}
          </Text>
        ) : null}

        {results.map((u) => (
          <Pressable
            key={u.id}
            onPress={() => openDm(u)}
            disabled={opening}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 14,
              paddingVertical: 11,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              backgroundColor: pressed ? theme.colors.bgElev : "transparent",
              opacity: opening ? 0.5 : 1,
            })}
          >
            <Avatar
              letter={(u.username[0] ?? "?").toUpperCase()}
              size={42}
              bg={colorFor(u.id)}
              uri={u.avatar_url}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={{ fontFamily: theme.fonts.mono, fontSize: 14, fontWeight: "600", color: theme.colors.ink }}
              >
                {theme.decorate ? `@${u.username}` : u.username}
              </Text>
              {u.status ? (
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.inkDim, marginTop: 1 }}
                >
                  {u.status}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}
