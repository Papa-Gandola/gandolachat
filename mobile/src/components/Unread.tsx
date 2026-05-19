import { Text, View } from "react-native";

import { useTheme } from "../theme";

interface Props {
  count?: number;
}

export function Unread({ count }: Props) {
  const theme = useTheme();
  if (!count) return null;
  return (
    <View
      style={{
        minWidth: 18,
        height: 18,
        paddingHorizontal: 5,
        backgroundColor: theme.colors.accent,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontWeight: "800",
          fontSize: 11,
          color: theme.colors.accentText,
        }}
      >
        {count > 99 ? "99+" : String(count)}
      </Text>
    </View>
  );
}
