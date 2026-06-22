import { Inter_400Regular, Inter_500Medium, useFonts as useInter } from "@expo-google-fonts/inter";
import {
  JetBrainsMono_500Medium,
  useFonts as useMono,
} from "@expo-google-fonts/jetbrains-mono";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RootNavigator } from "./src/navigation/RootNavigator";
import { AuthProvider } from "./src/services/AuthContext";
import { CallProvider } from "./src/services/CallContext";
import { initWebPwa } from "./src/services/webPwa";
import { ThemeProvider } from "./src/theme/ThemeProvider";

export default function App() {
  const [interLoaded] = useInter({ Inter_400Regular, Inter_500Medium });
  const [monoLoaded] = useMono({ JetBrainsMono_500Medium });

  useEffect(() => {
    // Match the system surface so the status bar / nav bar match the dark
    // theme even before React mounts.
    SystemUI.setBackgroundColorAsync("#0a0a0a");
    // iOS PWA meta tags + service worker registration (no-op on native).
    initWebPwa();
  }, []);

  if (!interLoaded || !monoLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <CallProvider>
              <RootNavigator />
            </CallProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
