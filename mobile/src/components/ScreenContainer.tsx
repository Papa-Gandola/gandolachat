import { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../theme";
import { Scanlines } from "./Scanlines";

interface Props {
  children: ReactNode;
  // When the screen owns its full surface (e.g. video call), skip safe-area
  // padding so content can run edge-to-edge.
  edgeToEdge?: boolean;
}

export function ScreenContainer({ children, edgeToEdge = false }: Props) {
  const theme = useTheme();
  if (edgeToEdge) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <View style={{ flex: 1 }}>{children}</View>
        <Scanlines />
      </View>
    );
  }
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      edges={["top", "left", "right"]}
    >
      <View style={{ flex: 1 }}>{children}</View>
      <Scanlines />
    </SafeAreaView>
  );
}
