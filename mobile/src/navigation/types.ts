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
    // When non-null, ChatScreen highlights and scrolls to the matching
    // message. scrollToTick is just a "did the user click again?" marker so
    // navigating to the same message twice still triggers the effect.
    scrollToMessageId?: number;
    scrollToTick?: number;
  };
  GroupChat: {
    chatId: string;
    name: string;
    userId?: number;
    avatarUrl?: string | null;
    isGroup?: boolean;
    allowAllWrite?: boolean;
    createdBy?: number;
    scrollToMessageId?: number;
    scrollToTick?: number;
  };
  ChatInfo: { chatId: string };
  MessageSearch: { chatId: string; chatName: string };
  OtherProfile: { userId: number };
  MediaViewer: { url: string };
  Camera: { chatId: string };
  Poker: { chatId: string; chatName: string };
};

export type ProfileStackParamList = {
  MyProfile: undefined;
  Settings: undefined;
};

export type MainTabsParamList = {
  Chats: NavigatorScreenParams<ChatsStackParamList>;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabsParamList>;
};
