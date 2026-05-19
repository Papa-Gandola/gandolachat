import { NavigatorScreenParams } from "@react-navigation/native";

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type ChatsStackParamList = {
  ChatsList: undefined;
  Search: undefined;
  NewChat: undefined;
  NewGroup: undefined;
  Chat: { chatId: string; name: string };
  GroupChat: { chatId: string; name: string };
  ChatInfo: { chatId: string };
  OtherProfile: { userId: string };
  MediaViewer: { url: string };
  StickerPicker: undefined;
};

export type CallsStackParamList = {
  CallsList: undefined;
  ActiveCall: { chatId: string };
};

export type ProfileStackParamList = {
  MyProfile: undefined;
  Settings: undefined;
};

export type MainTabsParamList = {
  Chats: NavigatorScreenParams<ChatsStackParamList>;
  Calls: NavigatorScreenParams<CallsStackParamList>;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabsParamList>;
};
