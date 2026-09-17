import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { useIsWide } from "../../components/useIsWide";
import { ChatsStackParamList } from "../../navigation/types";
import { useTheme } from "../../theme";
import { ChatsListPane } from "./ChatsListPane";

type Props = NativeStackScreenProps<ChatsStackParamList, "ChatsList">;

// Первый экран стека чатов. На телефоне — сам список (ChatsListPane).
// На широком экране список живёт в левой колонке (ChatsSidebar), а этот
// экран — заглушка «выбери чат слева»: он остаётся корнем стека, к
// которому ведёт «назад» из переписки.
export function ChatsListScreen({ navigation }: Props) {
  const theme = useTheme();
  const isWide = useIsWide();
  if (isWide) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 }}>
          <Text style={{ fontSize: 40 }}>💬</Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 14, color: theme.colors.inkDim, textAlign: "center" }}>
            {theme.decorate ? "// выбери чат слева" : "Выбери чат слева"}
          </Text>
        </View>
      </ScreenContainer>
    );
  }
  return (
    <ChatsListPane
      onOpenChat={(screen, params) => navigation.navigate(screen, params)}
      onOpenSearch={() => navigation.navigate("Search")}
      onOpenNewChat={() => navigation.navigate("NewChat")}
    />
  );
}
