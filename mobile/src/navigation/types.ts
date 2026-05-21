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
  Chat: {
    chatId: string;
    name: string;
    userId?: number;
    avatarUrl?: string | null;
    isGroup?: boolean;
    allowAllWrite?: boolean;
    createdBy?: number;
  };
  GroupChat: {
    chatId: string;
    name: string;
    userId?: number;
    avatarUrl?: string | null;
    isGroup?: boolean;
    allowAllWrite?: boolean;
    createdBy?: number;
  };
  ChatInfo: { chatId: string };
  OtherProfile: { userId: number };
  MediaViewer: { url: string };
  StickerPicker: undefined;
  Camera: { chatId: string };
  Poker: { chatId: string; chatName: string };
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
