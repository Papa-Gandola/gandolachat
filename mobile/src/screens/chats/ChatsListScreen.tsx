import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { ChatRow } from "../../components/ChatRow";
import { Chip } from "../../components/Chip";
import { IconBtn } from "../../components/IconBtn";
import { PlusIcon, SearchIcon, SettingsIcon } from "../../components/icons";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { useChats } from "../../services/useChats";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "ChatsList">;

export function ChatsListScreen({ navigation }: Props) {
  const theme = useTheme();
  const { chats, loading, error, refresh } = useChats();

  const totalUnread = chats.reduce((sum, c) => sum + (c.unread ?? 0), 0);
  const groupsCount = chats.filter((c) => c.group).length;

  return (
    <ScreenContainer>
      <AppBar
        title="GandolaChat"
        sub={
          chats.length
            ? theme.decorate
              ? `${chats.filter((c) => c.online).length} / ${chats.length} онлайн`
              : `${chats.filter((c) => c.online).length} из ${chats.length} онлайн`
            : theme.decorate
              ? "загрузка..."
              : "Загрузка..."
        }
        right={
          <View style={{ flexDirection: "row" }}>
            <IconBtn onPress={() => navigation.navigate("Search")}>
              <SearchIcon color={theme.colors.ink} />
            </IconBtn>
            <IconBtn>
              <SettingsIcon color={theme.colors.ink} />
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
          <Chip on>{theme.decorate ? "● ВСЕ" : "Все"}</Chip>
          <Chip>
            {theme.decorate ? `НЕПРОЧИТАННЫЕ · ${totalUnread}` : `Непрочитанные · ${totalUnread}`}
          </Chip>
          <Chip>{theme.decorate ? `ГРУППЫ · ${groupsCount}` : `Группы · ${groupsCount}`}</Chip>
          <Chip>{theme.decorate ? "АРХИВ" : "Архив"}</Chip>
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
        {chats.length === 0 && !loading && !error ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                color: theme.colors.inkMuted,
                fontSize: 12,
                textAlign: "center",
              }}
            >
              {theme.decorate ? "// пока пусто" : "Пока пусто"}
            </Text>
            <Text
              style={{
                marginTop: 8,
                fontFamily: theme.fonts.body,
                color: theme.colors.inkDim,
                fontSize: 12.5,
                textAlign: "center",
                maxWidth: 240,
              }}
            >
              Начни первый чат — кнопка справа внизу.
            </Text>
          </View>
        ) : null}
        {chats.map((c) => (
          <ChatRow
            key={c.id}
            chat={c}
            onPress={() =>
              navigation.navigate(c.group ? "GroupChat" : "Chat", {
                chatId: c.id,
                name: c.name,
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
