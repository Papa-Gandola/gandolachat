import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { View } from "react-native";

import { BottomTabs } from "../components/BottomTabs";
import { useIsWide } from "../components/useIsWide";
import { CompendiumScreen } from "../screens/compendium/CompendiumScreen";
import { ChatsSidebar } from "./ChatsSidebar";
import { ChatsStack } from "./ChatsStack";
import { ProfileStack } from "./ProfileStack";
import { MainTabsParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabsParamList>();

export function MainTabs() {
  const isWide = useIsWide();
  // Широкий экран: список чатов слева колонкой, вкладки (переписка,
  // Гандолиум, профиль) — справа. Обёртка одна и та же в обоих режимах, а
  // колонка — первый ребёнок с ключом: при смене ширины (поворот планшета,
  // ресайз окна) навигатор остаётся на месте и не теряет состояние.
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      {isWide ? <ChatsSidebar key="side" /> : null}
      <View key="main" style={{ flex: 1 }}>
        <Tab.Navigator tabBar={(props) => <BottomTabs {...props} />} screenOptions={{ headerShown: false }}>
          <Tab.Screen name="Chats" component={ChatsStack} />
          <Tab.Screen name="Compendium" component={CompendiumScreen} />
          <Tab.Screen name="Profile" component={ProfileStack} />
        </Tab.Navigator>
      </View>
    </View>
  );
}
