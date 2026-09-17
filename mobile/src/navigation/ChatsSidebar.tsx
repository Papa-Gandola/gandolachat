import { CommonActions } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { ChatsListPane, ChatOpenParams, ChatTarget } from "../screens/chats/ChatsListPane";
import { useTheme } from "../theme";
import { navigationRef } from "./navigationRef";

export const SIDEBAR_WIDTH = 340;

// Левая колонка широкого экрана (PWA в браузере на компе, планшет в
// ландшафте): постоянный список чатов. Живёт ВНЕ стека, поэтому ходит по
// навигации через глобальный ref — так же, как тап по пушу
// (navigateToChat). Открытый чат подсвечивается по текущему маршруту.
export function ChatsSidebar() {
  const theme = useTheme();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      if (!navigationRef.isReady()) return;
      const route = navigationRef.getCurrentRoute();
      const params = route?.params as { chatId?: string | number } | undefined;
      const isChat = route?.name === "Chat" || route?.name === "GroupChat";
      setActiveChatId(isChat && params?.chatId != null ? String(params.chatId) : null);
    };
    read();
    return navigationRef.addListener("state", read);
  }, []);

  // navigate (а не push): если такой чат уже открыт справа — просто
  // обновятся параметры, стек не растёт с каждым кликом по списку.
  const goChats = (screen: ChatTarget | "Search" | "NewChat", params?: ChatOpenParams) => {
    if (!navigationRef.isReady()) return;
    navigationRef.dispatch(
      CommonActions.navigate({
        name: "Main",
        params: { screen: "Chats", params: params ? { screen, params } : { screen } },
      }),
    );
  };

  return (
    <View style={{ width: SIDEBAR_WIDTH, borderRightWidth: 1, borderRightColor: theme.colors.border, backgroundColor: theme.colors.bg }}>
      <ChatsListPane
        activeChatId={activeChatId}
        onOpenChat={(screen, params) => goChats(screen, params)}
        onOpenSearch={() => goChats("Search")}
        onOpenNewChat={() => goChats("NewChat")}
      />
    </View>
  );
}
