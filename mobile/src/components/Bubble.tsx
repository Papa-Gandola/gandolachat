import { ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { useTheme } from "../theme";
import { ReadBar, ReadStatus } from "./ReadBar";

interface Props {
  mine?: boolean;
  text?: string;
  ts?: string;
  status?: ReadStatus;
  imageUri?: string | null;
  onPressImage?: () => void;
  // Custom media rendered above the text (e.g. a voice-message player).
  media?: ReactNode;
  // Quoted message this one is replying to.
  reply?: { author: string; text: string } | null;
  // Show the "edited" marker next to the timestamp.
  edited?: boolean;
  children?: ReactNode;
}

export function Bubble({ mine = false, text, ts, status, imageUri, onPressImage, media, reply, edited, children }: Props) {
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
        {reply ? (
          <View
            style={{
              borderLeftWidth: 3,
              borderLeftColor: mine ? theme.colors.bubbleMineText : theme.colors.accent,
              paddingLeft: 8,
              paddingVertical: 2,
              marginBottom: 6,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 11,
                fontWeight: "700",
                color: mine ? theme.colors.bubbleMineText : theme.colors.accent,
              }}
            >
              {reply.author}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontSize: 12, color: mine ? theme.colors.bubbleMineText : theme.colors.inkDim }}
            >
              {reply.text}
            </Text>
          </View>
        ) : null}
        {imageUri ? (
          <Pressable onPress={onPressImage}>
            <Image
              source={{ uri: imageUri }}
              style={{
                width: 220,
                height: 220,
                borderRadius: 8,
                marginBottom: text ? 6 : 0,
                backgroundColor: "rgba(255,255,255,0.05)",
              }}
              resizeMode="cover"
            />
          </Pressable>
        ) : null}
        {media}
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
            {edited ? (
              <Text
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: 10,
                  fontStyle: "italic",
                  color: mine ? "rgba(10,10,10,0.55)" : theme.colors.inkMuted,
                }}
              >
                ред.
              </Text>
            ) : null}
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
