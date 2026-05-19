import { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "../theme";

type Variant = "primary" | "secondary" | "danger";

interface Props {
  children: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: ReactNode;
  disabled?: boolean;
}

export function NeoButton({ children, onPress, variant = "primary", icon, disabled }: Props) {
  const theme = useTheme();

  let bg: string;
  let color: string;
  let borderColor: string | undefined;

  if (variant === "primary") {
    bg = theme.colors.accent;
    color = theme.colors.accentText;
    borderColor = undefined;
  } else if (variant === "danger") {
    bg = theme.colors.danger;
    color = "#ffffff";
    borderColor = undefined;
  } else {
    bg = "transparent";
    color = theme.colors.ink;
    borderColor = theme.colors.borderStrong;
  }

  // Neo theme wraps button text in [BRACKETS] for that terminal feel.
  const label = theme.decorate && variant === "primary" ? `[${children}]` : children;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        padding: 14,
        backgroundColor: bg,
        borderWidth: borderColor ? 1 : 0,
        borderColor,
        borderRadius: theme.radius.md,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {icon ? <View>{icon}</View> : null}
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontWeight: "800",
          fontSize: 12.5,
          letterSpacing: theme.decorate ? 2 : 0.5,
          color,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
