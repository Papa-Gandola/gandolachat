import { Pressable, Text, View } from "react-native";

import { useTheme } from "../theme";

interface Props {
  name?: string | null;
  mine: boolean;
  onOpen: () => void;
}

// Видео в пузыре — тёмная плашка с ▶ и именем файла; по тапу ролик
// открывается во ВЕСЬ ЭКРАН (MediaViewer), как фото.
//
// Инлайн-плеер прямо в ленте не годится: строка сообщения обёрнута в
// Pressable (двойной тап = ❤️, долгий = меню) и Swipeable (свайп =
// ответить), и они перехватывают касания у нативных контролов плеера —
// в 0.9.0 ролик запускался, но его нельзя было ни остановить, ни
// перемотать, ни развернуть. Плюс десяток смонтированных плееров в ленте
// это десяток декодеров и трафик впустую.
const W = 240;
const H = 135; // 16:9 — настоящее соотношение видно уже в полноэкранном плеере

export function VideoMessage({ name, mine, onOpen }: Props) {
  const theme = useTheme();
  const fg = mine ? theme.colors.bubbleMineText : theme.colors.accent;

  return (
    <Pressable
      onPress={onOpen}
      style={{
        width: W,
        height: H,
        borderRadius: 8,
        backgroundColor: "rgba(0,0,0,0.35)",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 6,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: mine ? "rgba(10,10,10,0.35)" : theme.colors.bgElevH,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: fg, fontSize: 20, marginLeft: 3 }}>▶</Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          position: "absolute",
          left: 8,
          right: 8,
          bottom: 6,
          fontFamily: theme.fonts.mono,
          fontSize: 10,
          color: "rgba(255,255,255,0.8)",
        }}
      >
        {name || "видео"}
      </Text>
    </Pressable>
  );
}
