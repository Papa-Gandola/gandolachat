import { ReactNode } from "react";
import { Pressable, View } from "react-native";

interface Props {
  children: ReactNode;
  onPress?: () => void;
  size?: number;
  disabled?: boolean;
  /** Подпись для скринридера (в вебе — aria-label): кнопка без текста. */
  label?: string;
}

export function IconBtn({ children, onPress, size = 36, disabled, label }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <View pointerEvents="none">{children}</View>
    </Pressable>
  );
}
