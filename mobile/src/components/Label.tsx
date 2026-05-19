import { StyleProp, Text, TextStyle } from "react-native";

import { useTheme } from "../theme";

interface Props {
  children: string;
  style?: StyleProp<TextStyle>;
  variant?: "section" | "field" | "plain";
}

// Renders text with theme-aware decoration. In Neo theme, section/field labels
// get the "// LABEL" prefix and uppercase monospace; in Discord they render
// as plain sentence-case sans.
export function Label({ children, style, variant = "plain" }: Props) {
  const theme = useTheme();
  const decorate = theme.decorate;

  const baseStyle: TextStyle = {
    color: theme.colors.inkMuted,
    fontFamily: theme.fonts.mono,
  };

  if (variant === "section") {
    return (
      <Text
        style={[
          baseStyle,
          {
            fontSize: 10,
            fontWeight: "700",
            letterSpacing: 1.2,
            textTransform: decorate ? "uppercase" : "none",
          },
          style,
        ]}
      >
        {decorate ? `// ${children.toUpperCase()}` : children}
      </Text>
    );
  }

  if (variant === "field") {
    return (
      <Text
        style={[
          baseStyle,
          {
            fontSize: 10,
            fontWeight: "600",
            letterSpacing: 1.2,
            marginBottom: 6,
            textTransform: decorate ? "uppercase" : "none",
          },
          style,
        ]}
      >
        {decorate ? `// ${children.toUpperCase().replace(/\s+/g, "_")}` : children}
      </Text>
    );
  }

  return <Text style={[baseStyle, style]}>{children}</Text>;
}
