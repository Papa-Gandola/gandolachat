import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../theme";
import { ChatBubbleIcon, PersonIcon } from "./icons";
import { Unread } from "./Unread";

interface TabSpec {
  routeName: string;
  label: string;
  iconKey: "chats" | "profile";
  badge?: number;
}

const TABS: TabSpec[] = [
  { routeName: "Chats", label: "ЧАТЫ", iconKey: "chats" },
  { routeName: "Profile", label: "Я", iconKey: "profile" },
];

export function BottomTabs({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const activeRoute = state.routes[state.index].name;
  return (
    <View
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.bg,
        paddingBottom: Math.max(insets.bottom, 6),
      }}
    >
      {TABS.map((tab) => {
        const active = activeRoute === tab.routeName;
        const onPress = () => {
          if (!active) navigation.navigate(tab.routeName);
        };
        const tint = active ? theme.colors.accent : theme.colors.inkDim;
        return (
          <Pressable
            key={tab.routeName}
            onPress={onPress}
            style={{
              flex: 1,
              paddingTop: 10,
              paddingBottom: 12,
              alignItems: "center",
              gap: 4,
              position: "relative",
            }}
          >
            {active ? (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: "30%",
                  right: "30%",
                  height: 2,
                  backgroundColor: theme.colors.accent,
                }}
              />
            ) : null}
            <TabIcon iconKey={tab.iconKey} color={tint} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Text
                style={{
                  color: tint,
                  fontFamily: theme.fonts.mono,
                  fontSize: 10.5,
                  fontWeight: "600",
                  letterSpacing: 0.6,
                }}
              >
                {theme.decorate ? tab.label : prettyLabel(tab.label)}
              </Text>
              {active && tab.badge ? <Unread count={tab.badge} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function prettyLabel(uppercase: string): string {
  const lower = uppercase.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function TabIcon({ iconKey, color }: { iconKey: TabSpec["iconKey"]; color: string }) {
  if (iconKey === "chats") return <ChatBubbleIcon color={color} />;
  return <PersonIcon color={color} />;
}
