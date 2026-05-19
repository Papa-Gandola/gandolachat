import { Text, View } from "react-native";

import { useTheme } from "../theme";

interface Props {
  letter: string;
  size?: number;
  bg?: string;
  online?: boolean;
  square?: boolean;
}

export function Avatar({ letter, size = 38, bg = "#3a3a3a", online = false, square = false }: Props) {
  const theme = useTheme();
  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: square ? 6 : size / 2,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontWeight: "800",
            fontSize: size * 0.42,
            color: "#fff",
          }}
        >
          {letter}
        </Text>
      </View>
      {online && (
        <View
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: 11,
            height: 11,
            backgroundColor: theme.colors.online,
            borderRadius: square ? 2 : 6,
            borderWidth: 2,
            borderColor: theme.colors.bg,
          }}
        />
      )}
    </View>
  );
}
