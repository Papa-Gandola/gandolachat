import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { ChatInfoScreen } from "../screens/chats/ChatInfoScreen";
import { ChatScreen } from "../screens/chats/ChatScreen";
import { ChatsListScreen } from "../screens/chats/ChatsListScreen";
import { GroupChatScreen } from "../screens/chats/GroupChatScreen";
import { NewChatScreen } from "../screens/chats/NewChatScreen";
import { NewGroupScreen } from "../screens/chats/NewGroupScreen";
import { PokerScreen } from "../screens/chats/PokerScreen";
import { SearchScreen } from "../screens/chats/SearchScreen";
import { CameraScreen } from "../screens/extras/CameraScreen";
import { MediaViewerScreen } from "../screens/extras/MediaViewerScreen";
import { StickerPickerScreen } from "../screens/extras/StickerPickerScreen";
import { OtherProfileScreen } from "../screens/profile/OtherProfileScreen";
import { ChatsStackParamList } from "./types";

const Stack = createNativeStackNavigator<ChatsStackParamList>();

export function ChatsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ChatsList" component={ChatsListScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="NewChat" component={NewChatScreen} />
      <Stack.Screen name="NewGroup" component={NewGroupScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="GroupChat" component={GroupChatScreen} />
      <Stack.Screen name="ChatInfo" component={ChatInfoScreen} />
      <Stack.Screen name="OtherProfile" component={OtherProfileScreen} />
      <Stack.Screen name="Poker" component={PokerScreen} />
      <Stack.Screen
        name="MediaViewer"
        component={MediaViewerScreen}
        options={{ presentation: "modal", animation: "fade" }}
      />
      <Stack.Screen
        name="StickerPicker"
        component={StickerPickerScreen}
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="Camera"
        component={CameraScreen}
        options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
      />
    </Stack.Navigator>
  );
}
