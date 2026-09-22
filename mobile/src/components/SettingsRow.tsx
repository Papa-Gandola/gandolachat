import { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "../theme";

interface Props {
  label: string;
  /** Мелкий текст справа (версия, состояние). */
  value?: string;
  /** Лаймовый бейдж перед шевроном (например, число найденных обновлений). */
  badge?: string | number | null;
  right?: ReactNode;
  onPress: () => void;
}

/** Строка настроек «подпись · значение · ›». */
export function SettingsRow({ label, value, badge, right, onPress }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.bgElev : "transparent",
      })}
    >
      <Text style={{ flex: 1, fontSize: 13.5, color: theme.colors.ink, fontFamily: theme.fonts.body }}>{label}</Text>
      {value ? (
        <Text style={{ color: theme.colors.inkDim, fontFamily: theme.fonts.mono, fontSize: 11 }}>{value}</Text>
      ) : null}
      {right}
      {badge != null && badge !== "" && badge !== 0 ? (
        <View
          style={{
            minWidth: 18,
            height: 18,
            paddingHorizontal: 5,
            borderRadius: 9,
            backgroundColor: theme.colors.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, fontWeight: "700", color: theme.colors.accentText }}>
            {String(badge)}
          </Text>
        </View>
      ) : null}
      <Text style={{ color: theme.colors.inkMuted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}
