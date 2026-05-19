import { ReactNode } from "react";
import { Text, View } from "react-native";

import { useTheme } from "../theme";
import { ReadBar, ReadStatus } from "./ReadBar";

interface Props {
  mine?: boolean;
  text?: string;
  ts?: string;
  status?: ReadStatus;
  children?: ReactNode;
}

export function Bubble({ mine = false, text, ts, status, children }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: mine ? "flex-end" : "flex-start",
        paddingHorizontal: 14,
        paddingVertical: 3,
      }}
    >
      <View
        style={{
          maxWidth: "78%",
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: mine ? theme.colors.bubbleMine : theme.colors.bubbleOther,
          borderWidth: mine ? 0 : 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.bubble,
          borderTopLeftRadius: mine ? theme.radius.bubble : 6,
          borderTopRightRadius: mine ? 6 : theme.radius.bubble,
        }}
      >
        {text ? (
          <Text
            style={{
              fontSize: 13.5,
              lineHeight: 19,
              fontFamily: theme.fonts.body,
              color: mine ? theme.colors.bubbleMineText : theme.colors.bubbleOtherText,
            }}
          >
            {text}
          </Text>
        ) : null}
        {children}
        {ts ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 3,
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 10,
                color: mine ? "rgba(10,10,10,0.55)" : theme.colors.inkMuted,
              }}
            >
              {ts}
            </Text>
            {mine && status ? <ReadBar status={status} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
