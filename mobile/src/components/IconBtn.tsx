import { ReactNode } from "react";
import { Pressable, View } from "react-native";

interface Props {
  children: ReactNode;
  onPress?: () => void;
  size?: number;
  disabled?: boolean;
}

export function IconBtn({ children, onPress, size = 36, disabled }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
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
