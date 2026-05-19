import { ReactNode } from "react";
import { TextInput, View } from "react-native";

import { useTheme } from "../theme";
import { Label } from "./Label";

interface Props {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  icon?: ReactNode;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address" | "numeric";
  multiline?: boolean;
}

// Single styled input. In Neo it's a square framed monospace box with the
// "// LABEL" caption above; in Discord it's a rounded soft box with a plain
// label.
export function NeoField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  icon,
  autoCapitalize = "sentences",
  keyboardType = "default",
  multiline = false,
}: Props) {
  const theme = useTheme();
  return (
    <View>
      {label ? <Label variant="field">{label}</Label> : null}
      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 12,
          backgroundColor: theme.colors.bgInput,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: value ? theme.colors.borderStrong : theme.colors.border,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        {icon}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.inkMuted}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          multiline={multiline}
          style={{
            flex: 1,
            color: theme.colors.ink,
            fontFamily: theme.fonts.mono,
            fontSize: 13,
            padding: 0,
          }}
        />
      </View>
    </View>
  );
}
