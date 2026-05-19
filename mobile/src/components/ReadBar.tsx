import { Text, View } from "react-native";

import { useTheme } from "../theme";

export type ReadStatus = "sending" | "sent" | "delivered" | "read";

interface Props {
  status: ReadStatus;
  // Color overrides for use on coloured (own-bubble) backgrounds.
  fillColor?: string;
  emptyColor?: string;
}

const FILL_LEVEL: Record<ReadStatus, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

// Neo theme: three notch bars. Discord: ✓ / ✓✓ ticks.
export function ReadBar({ status, fillColor, emptyColor }: Props) {
  const theme = useTheme();
  if (theme.id === "discord") {
    const tick = status === "read" || status === "delivered" ? "✓✓" : status === "sent" ? "✓" : "•";
    return (
      <Text
        style={{
          color: fillColor || theme.colors.inkDim,
          fontSize: 11,
        }}
      >
        {tick}
      </Text>
    );
  }
  const fill = FILL_LEVEL[status];
  const filled = fillColor || "rgba(10,10,10,0.85)";
  const empty = emptyColor || "rgba(10,10,10,0.22)";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, height: 8 }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 9,
            height: 3,
            borderRadius: 1,
            backgroundColor: i < fill ? filled : empty,
          }}
        />
      ))}
    </View>
  );
}
