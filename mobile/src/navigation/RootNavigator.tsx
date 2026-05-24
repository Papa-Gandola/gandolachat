import { NavigationContainer, Theme as NavTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useAuth } from "../services/AuthContext";
import { initNotificationTapHandler } from "../services/notificationTapHandler";
import { useTheme } from "../theme";
import { AuthStack } from "./AuthStack";
import { MainTabs } from "./MainTabs";
import { navigationRef } from "./navigationRef";
import { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { token, ready } = useAuth();
  const theme = useTheme();

  // Don't render anything until we've checked storage — avoids the Auth
  // stack flashing for a moment when a saved token was about to log in.
  if (!ready) return null;

  const navTheme: NavTheme = {
    dark: true,
    colors: {
      primary: theme.colors.accent,
      background: theme.colors.bg,
      card: theme.colors.bg,
      text: theme.colors.ink,
      border: theme.colors.border,
      notification: theme.colors.danger,
    },
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={() => {
        // Hook up notification tap → deeplink handler now that we have a
        // navigation ref ready to dispatch against.
        initNotificationTapHandler();
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {token == null ? (
          <Stack.Screen name="Auth" component={AuthStack} />
        ) : (
          <Stack.Screen name="Main" component={MainTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
