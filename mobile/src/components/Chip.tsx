import { ReactNode } from "react";
import { Text, View } from "react-native";

import { useTheme } from "../theme";

interface Props {
  children: ReactNode;
  on?: boolean;
}

export function Chip({ children, on = false }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingVertical: 3,
        paddingHorizontal: 8,
        borderRadius: theme.radius.sm,
        backgroundColor: on ? theme.colors.accent : "transparent",
        borderWidth: 1,
        borderColor: on ? theme.colors.accent : theme.colors.border,
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.8,
          color: on ? theme.colors.accentText : theme.colors.inkDim,
        }}
      >
        {children}
      </Text>
    </View>
  );
}
