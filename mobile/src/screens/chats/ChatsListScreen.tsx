import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ScrollView, Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { ChatRow } from "../../components/ChatRow";
import { Chip } from "../../components/Chip";
import { IconBtn } from "../../components/IconBtn";
import { PlusIcon, SearchIcon, SettingsIcon } from "../../components/icons";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { CHAT_LIST } from "../../services/mockData";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "ChatsList">;

export function ChatsListScreen({ navigation }: Props) {
  const theme = useTheme();
  return (
    <ScreenContainer>
      <AppBar
        title="GandolaChat"
        sub={theme.decorate ? "3 / 9 онлайн" : "3 из 9 онлайн"}
        right={
          <View style={{ flexDirection: "row" }}>
            <IconBtn onPress={() => navigation.navigate("Search")}>
              <SearchIcon color={theme.colors.ink} />
            </IconBtn>
            <IconBtn>
              {/* TODO: navigate to Settings via Profile tab once tab nav typing is wired up */}
              <SettingsIcon color={theme.colors.ink} />
            </IconBtn>
          </View>
        }
      />

      {/* Filter chips. Wrapped in a fixed-height View — bare horizontal
          ScrollView would flex-grow into the column and push the chat list
          to the bottom of the screen. */}
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
          <Chip>{theme.decorate ? "НЕПРОЧИТАННЫЕ · 19" : "Непрочитанные · 19"}</Chip>
          <Chip>{theme.decorate ? "ГРУППЫ · 2" : "Группы · 2"}</Chip>
          <Chip>{theme.decorate ? "АРХИВ" : "Архив"}</Chip>
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {CHAT_LIST.map((c) => (
          <ChatRow
            key={c.id}
            chat={c}
            onPress={() => navigation.navigate(c.group ? "GroupChat" : "Chat", { chatId: c.id, name: c.name })}
          />
        ))}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: theme.colors.bgElev,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: theme.colors.accent, fontSize: 14 }}>📁</Text>
          </View>
          <Text
            style={{
              flex: 1,
              color: theme.colors.inkDim,
              fontFamily: theme.fonts.mono,
              fontSize: 12.5,
            }}
          >
            Архивированные
          </Text>
          <Text style={{ color: theme.colors.inkMuted, fontSize: 11 }}>4</Text>
        </View>
      </ScrollView>

      {/* FAB */}
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
