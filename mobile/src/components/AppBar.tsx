import { ReactNode } from "react";
import { Text, View } from "react-native";

import { useTheme } from "../theme";

interface Props {
  title: string;
  sub?: string;
  left?: ReactNode;
  right?: ReactNode;
}

export function AppBar({ title, sub, left, right }: Props) {
  const theme = useTheme();
  // Neo theme decorates titles with "// PREFIX" style when caller passes raw text;
  // we render whatever the caller gave so individual screens can opt in.
  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingTop: 8,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: theme.colors.bg,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      {left ? <View>{left}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: theme.fonts.mono,
            fontWeight: "700",
            fontSize: 14,
            color: theme.colors.ink,
            letterSpacing: 0.2,
          }}
        >
          {title}
        </Text>
        {sub ? (
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 10.5,
              color: theme.colors.inkDim,
              marginTop: 1,
            }}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      {right ? <View style={{ flexDirection: "row", alignItems: "center" }}>{right}</View> : null}
    </View>
  );
}
