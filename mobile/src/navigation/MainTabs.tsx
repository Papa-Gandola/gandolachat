import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { BottomTabs } from "../components/BottomTabs";
import { CompendiumScreen } from "../screens/compendium/CompendiumScreen";
import { ChatsStack } from "./ChatsStack";
import { ProfileStack } from "./ProfileStack";
import { MainTabsParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabsParamList>();

export function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <BottomTabs {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Chats" component={ChatsStack} />
      <Tab.Screen name="Compendium" component={CompendiumScreen} />
      <Tab.Screen name="Profile" component={ProfileStack} />
    </Tab.Navigator>
  );
}
