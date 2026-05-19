import { Text, View } from "react-native";

import { useTheme } from "../theme";

interface Props {
  size?: number;
}

export function GandolaLogo({ size = 44 }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor: theme.colors.accent,
        borderRadius: theme.id === "neo" ? size * 0.22 : size * 0.5,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontWeight: "800",
          fontSize: size * 0.62,
          color: theme.colors.accentText,
        }}
      >
        G
      </Text>
    </View>
  );
}
