import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { MyProfileScreen } from "../screens/profile/MyProfileScreen";
import { SettingsScreen } from "../screens/profile/SettingsScreen";
import { ProfileStackParamList } from "./types";

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MyProfile" component={MyProfileScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}
