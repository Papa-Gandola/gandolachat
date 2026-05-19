import { View } from "react-native";

import { useTheme } from "../theme";

// Repeating horizontal hairlines used by the Neo theme. RN doesn't have CSS
// repeating gradients, and Image won't render an inline SVG data-URI on every
// platform, so we just stack thin lines manually. Cheap (~250 small Views)
// and only drawn once per screen.
const LINE_EVERY_PX = 3;
const TOTAL_LINES = 280; // covers ~840px tall — enough for any phone

export function Scanlines() {
  const theme = useTheme();
  if (!theme.scanlines) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: 0.035,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: TOTAL_LINES }).map((_, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            top: i * LINE_EVERY_PX,
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: "#ffffff",
          }}
        />
      ))}
    </View>
  );
}
