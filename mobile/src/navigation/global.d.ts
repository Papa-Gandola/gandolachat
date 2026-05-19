import { MainTabsParamList, RootStackParamList } from "./types";

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

// Augment so navigation.getParent() inside ChatsStack returns the typed Tab nav.
export type _MainTabsParamList = MainTabsParamList;
