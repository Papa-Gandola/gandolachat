import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { ChatRow } from "../../components/ChatRow";
import { Chip } from "../../components/Chip";
import { IconBtn } from "../../components/IconBtn";
import { PlusIcon, SearchIcon, SettingsIcon } from "../../components/icons";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { useChats } from "../../services/useChats";
import { useTheme, useThemeControls } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "ChatsList">;
type Filter = "all" | "groups" | "dms";

export function ChatsListScreen({ navigation }: Props) {
  const theme = useTheme();
  const { themeId, setThemeId } = useThemeControls();
  const { chats, loading, error, refresh } = useChats();
  const [filter, setFilter] = useState<Filter>("all");

  const visible = chats.filter((c) => {
    if (filter === "groups") return c.group;
    if (filter === "dms") return !c.group;
    return true;
  });

  // Count online friends (DMs only — groups don't have a single online state).
  const dms = chats.filter((c) => !c.group);
  const onlineFriends = dms.filter((c) => c.online).length;

  const toggleTheme = () => setThemeId(themeId === "neo" ? "discord" : "neo");

  return (
    <ScreenContainer>
      <AppBar
        title="GandolaChat"
        sub={
          chats.length
            ? `${onlineFriends} / ${dms.length} онлайн`
            : theme.decorate
              ? "загрузка..."
              : "Загрузка..."
        }
        right={
          <View style={{ flexDirection: "row" }}>
            <IconBtn onPress={() => navigation.navigate("Search")}>
              <SearchIcon color={theme.colors.ink} />
            </IconBtn>
            {/* The "sun" toggles between Neo and Discord themes */}
            <IconBtn onPress={toggleTheme}>
              <SettingsIcon color={theme.colors.accent} />
            </IconBtn>
          </View>
        }
      />

      <View style={{ height: 44 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 14,
            paddingTop: 10,
            paddingBottom: 6,
            gap: 6,
            alignItems: "center",
          }}
        >
          <FilterChip
            label={theme.decorate ? "● ВСЕ" : "Все"}
            active={filter === "all"}
            onPress={() => setFilter("all")}
          />
          <FilterChip
            label={theme.decorate ? "ГРУППЫ" : "Группы"}
            active={filter === "groups"}
            onPress={() => setFilter("groups")}
          />
          <FilterChip
            label={theme.decorate ? "ЛИЧНЫЕ" : "Личные"}
            active={filter === "dms"}
            onPress={() => setFilter("dms")}
          />
        </ScrollView>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={loading && chats.length > 0}
            onRefresh={refresh}
            tintColor={theme.colors.accent}
          />
        }
      >
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
        {chats.length === 0 && loading ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : null}
        {visible.length === 0 && !loading && !error ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                color: theme.colors.inkMuted,
                fontSize: 12,
                textAlign: "center",
              }}
            >
              {theme.decorate ? "// пусто" : "Пусто"}
            </Text>
          </View>
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
              })
            }
          />
        ))}
      </ScrollView>

      <View style={{ position: "absolute", right: 18, bottom: 18 }}>
        <IconBtn onPress={() => navigation.navigate("NewChat")} size={54}>
          <View
            style={{
              width: 54,
              height: 54,
              borderRadius: theme.id === "neo" ? 14 : 27,
              backgroundColor: theme.colors.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PlusIcon color={theme.colors.accentText} />
          </View>
        </IconBtn>
      </View>
    </ScreenContainer>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Chip on={active}>{label}</Chip>
    </Pressable>
  );
}
