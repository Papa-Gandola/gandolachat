import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ChatsStackParamList } from "../../navigation/types";
import { ChatScreen } from "./ChatScreen";

type Props = NativeStackScreenProps<ChatsStackParamList, "GroupChat">;

// Group chats reuse the DM chat UI for now. Per-sender avatar rows + the
// dedicated group composer features (mentions, channel mode hint) come in
// a later step.
export function GroupChatScreen(props: Props) {
  return <ChatScreen {...(props as unknown as NativeStackScreenProps<ChatsStackParamList, "Chat">)} />;
}
