import { Pressable, Text, View } from "react-native";

import { useTheme } from "../theme";
import { Avatar } from "./Avatar";
import { Unread } from "./Unread";

export interface ChatRowData {
  id: string;
  name: string;
  letter: string;
  color: string;
  last: string;
  ts: string;
  unread?: number;
  online?: boolean;
  group?: boolean;
  typing?: boolean;
  muted?: boolean;
  lastStatus?: string;
  // For DMs: the other participant's user id, so the chat screen can deep-link
  // into their profile. Undefined for groups.
  peerId?: number;
}

interface Props {
  chat: ChatRowData;
  onPress?: () => void;
}

export function ChatRow({ chat, onPress }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.bgElev : theme.colors.bg,
      })}
    >
      <Avatar
        letter={chat.letter}
        size={42}
        bg={chat.color}
        online={chat.online}
        square={chat.group}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 13.5,
              fontWeight: chat.unread ? "700" : "500",
              color: theme.colors.ink,
              flex: 1,
            }}
          >
            {chat.name}
          </Text>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 10.5,
              color: chat.unread ? theme.colors.accent : theme.colors.inkMuted,
            }}
          >
            {chat.ts}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 12.5,
              color: chat.typing ? theme.colors.accent : theme.colors.inkDim,
              flex: 1,
              fontFamily: chat.typing ? theme.fonts.mono : theme.fonts.body,
              fontStyle: chat.typing ? "italic" : "normal",
            }}
          >
            {chat.typing
              ? theme.decorate
                ? "> печатает…"
                : "печатает…"
              : (chat.lastStatus ? "✓ " : "") + chat.last}
          </Text>
          {chat.muted ? <Text style={{ color: theme.colors.inkMuted, fontSize: 13 }}>🔕</Text> : null}
          <Unread count={chat.unread} />
        </View>
      </View>
    </Pressable>
  );
}
