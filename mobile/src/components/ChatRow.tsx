import { Pressable, Text, View } from "react-native";

import { useTheme } from "../theme";
import { Avatar } from "./Avatar";
import { FormattedText } from "./FormattedText";
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
  avatarUrl?: string | null;
  createdBy?: number;
  allowAllWrite?: boolean;
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
        uri={chat.avatarUrl}
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
          {chat.typing ? (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 12.5,
                color: theme.colors.accent,
                flex: 1,
                fontFamily: theme.fonts.mono,
                fontStyle: "italic",
              }}
            >
              {theme.decorate ? "> печатает…" : "печатает…"}
            </Text>
          ) : (
            <FormattedText
              numberOfLines={1}
              noBold
              staticSpoiler
              text={(chat.lastStatus ? "✓ " : "") + chat.last}
              style={{
                fontSize: 12.5,
                color: theme.colors.inkDim,
                flex: 1,
                fontFamily: theme.fonts.body,
              }}
            />
          )}
          {chat.muted ? <Text style={{ color: theme.colors.inkMuted, fontSize: 13 }}>🔕</Text> : null}
          <Unread count={chat.unread} />
        </View>
      </View>
    </Pressable>
  );
}
