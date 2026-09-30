import { Text, View } from "react-native";

// Рубашки карт в покере (косметика ур.16, comp_extra.card_back): те же
// имена и цвета, что у десктопа (client/.../CardBack.tsx). Показываются на
// закрытых картах соперника за столом (PokerScreen) и в превью косметики.
export const CARD_BACK_LABELS: Record<string, string> = {
  lime: "Лайм",
  blood: "Кровь",
  gold: "Золото",
  pumpkin: "Тыква",
  ice: "Лёд",
  void: "Бездна",
};

const STYLES: Record<string, { bg: string; border: string; symbol: string; color: string }> = {
  lime: { bg: "#b7ef35", border: "#0a0a0a", symbol: "G", color: "#0a0a0a" },
  blood: { bg: "#5a0d0d", border: "#ff6a5e", symbol: "💀", color: "#ffffff" },
  gold: { bg: "#d4a017", border: "#fff1b8", symbol: "⛽", color: "#3d2b00" },
  pumpkin: { bg: "#ff8c1a", border: "#3f9d3a", symbol: "🎃", color: "#ffffff" },
  ice: { bg: "#7fc8ff", border: "#ffffff", symbol: "❄️", color: "#0b3d5c" },
  void: { bg: "#1a0b33", border: "#b23cff", symbol: "✦", color: "#e9d5ff" },
};

export function hasCardBack(back?: string | null): back is string {
  return !!back && !!STYLES[back];
}

export function CardBackFace({ back, w, h, radius }: { back: string; w: number; h: number; radius: number }) {
  const s = STYLES[back];
  if (!s) return null;
  return (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        backgroundColor: s.bg,
        borderWidth: 2,
        borderColor: s.border,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Text style={{ fontSize: Math.round(h * 0.34), color: s.color, fontWeight: "900" }}>{s.symbol}</Text>
    </View>
  );
}
