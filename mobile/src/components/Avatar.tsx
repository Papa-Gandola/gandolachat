import { Image, Text, View } from "react-native";

import { API_URL } from "../services/config";
import { useTheme } from "../theme";

interface Props {
  letter: string;
  size?: number;
  bg?: string;
  online?: boolean;
  square?: boolean;
  // Relative ("/uploads/avatars/..") or absolute avatar URL. When present the
  // image is rendered instead of the letter fallback.
  uri?: string | null;
}

function resolveUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  return `${API_URL}${uri.startsWith("/") ? "" : "/"}${uri}`;
}

export function Avatar({ letter, size = 38, bg = "#3a3a3a", online = false, square = false, uri }: Props) {
  const theme = useTheme();
  const resolved = resolveUri(uri);
  const radius = square ? 6 : size / 2;
  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      {resolved ? (
        <Image
          source={{ uri: resolved }}
          style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg }}
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontWeight: "800",
              fontSize: size * 0.42,
              color: "#fff",
            }}
          >
            {letter}
          </Text>
        </View>
      )}
      {online && (
        <View
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: Math.min(16, Math.max(12, size * 0.3)),
            height: Math.min(16, Math.max(12, size * 0.3)),
            backgroundColor: "#3ba55d",
            borderRadius: square ? 3 : size,
            borderWidth: 2.5,
            borderColor: theme.colors.bg,
          }}
        />
      )}
    </View>
  );
}
