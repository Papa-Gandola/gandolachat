import React from "react";
import { Gas } from "./Icon";
import { Emoji } from "./Emoji";

// Рубашки карт в покере (косметика ур.16, users.comp_extra.card_back):
// рисуются кодом по имени из CARD_BACKS сервера — одна картинка за столом
// (Poker.tsx, закрытые карты соперника) и в превью косметики
// (CompendiumPage). Мобилка — components/CardBack.tsx (те же цвета).
export const CARD_BACKS: Record<string, { label: string }> = {
  lime: { label: "Лайм" },
  blood: { label: "Кровь" },
  gold: { label: "Золото" },
  pumpkin: { label: "Тыква" },
  ice: { label: "Лёд" },
  void: { label: "Бездна" },
};

export function hasCardBack(back?: string | null): back is string {
  return !!back && !!CARD_BACKS[back];
}

export function CardBackFace({ back, w, h, radius }: { back: string; w: number; h: number; radius: number }) {
  const base: React.CSSProperties = {
    width: w, height: h, borderRadius: radius, boxSizing: "border-box", overflow: "hidden",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 900, lineHeight: 1, userSelect: "none", flexShrink: 0,
  };
  const sym = Math.round(h * 0.34);
  switch (back) {
    case "lime":
      return (
        <div style={{ ...base, background: "repeating-linear-gradient(45deg, #c6ff3d 0 5px, #a3d92c 5px 10px)", border: "2px solid #0a0a0a", color: "#0a0a0a", fontFamily: "var(--font-mono)", fontSize: sym }}>
          G
        </div>
      );
    case "blood":
      return (
        <div style={{ ...base, background: "radial-gradient(circle at 50% 40%, #a11616 0%, #3d0505 70%)", border: "2px solid #ff6a5e", fontSize: sym }}>
          <Emoji e="💀" />
        </div>
      );
    case "gold":
      return (
        <div style={{ ...base, background: "linear-gradient(135deg, #ffe08a 0%, #d4a017 45%, #8a6508 100%)", border: "2px solid #fff1b8", color: "#3d2b00" }}>
          <Gas size={sym} />
        </div>
      );
    case "pumpkin":
      return (
        <div style={{ ...base, background: "repeating-linear-gradient(90deg, #ff8c1a 0 6px, #e6750a 6px 9px)", border: "2px solid #3f9d3a", fontSize: sym }}>
          <Emoji e="🎃" />
        </div>
      );
    case "ice":
      return (
        <div style={{ ...base, background: "linear-gradient(160deg, #dff6ff 0%, #7fc8ff 50%, #2c7fb8 100%)", border: "2px solid #ffffff", fontSize: sym }}>
          <Emoji e="❄️" />
        </div>
      );
    case "void":
      return (
        <div style={{ ...base, background: "radial-gradient(circle at 30% 25%, #5a2aa8 0%, #1a0b33 45%, #05010c 100%)", border: "2px solid #b23cff", color: "#e9d5ff", fontSize: sym }}>
          ✦
        </div>
      );
    default:
      return null;
  }
}
