import React from "react";
import { CompExtra, UserOut } from "../services/api";
import { Gas } from "./Icon";
import { Emoji } from "./Emoji";

// Косметика Гандолиума: помощники отображения. Данные приходят в UserOut
// (comp_*), живые обновления — через profile_updated. С октября 2026 к
// старым полям добавился comp_extra (уровни 13–30): значок-эмодзи, свечение
// ника, обводка своих сообщений, свой титул, звезда легенды.

export const FRAME_LIME = "#c6ff3d";
export const FRAME_LEGEND = "#ffd24a";

// Любой объект с косметикой: UserOut, строка таблицы сезона, участник чата.
export type CosUser = {
  comp_color?: string | null;
  comp_badge?: boolean;
  comp_max_level?: number;
  comp_title?: string | null;
  comp_frame?: string | null;
  comp_extra?: CompExtra | null;
};

// Цвет ника: только если игрок выбрал (и сервер разрешил — валидация там)
export function nameColor(u?: Pick<UserOut, "comp_color"> | null): string | null {
  return u?.comp_color || null;
}

// Свечение ника (ур.15): text-shadow цветом ника или акцентом
export function glowStyle(u?: CosUser | null): React.CSSProperties {
  if (!u?.comp_extra?.glow) return {};
  const c = u.comp_color || "var(--accent)";
  return { textShadow: `0 0 6px ${c}, 0 0 14px ${c}` };
}

// Обводка пузырей сообщений (ур.17): inset-тень, чтобы не спорить с border
export function bubbleStyle(u?: CosUser | null): React.CSSProperties {
  const c = u?.comp_extra?.bubble;
  if (!c) return {};
  return { boxShadow: `inset 0 0 0 1.5px ${c}, 0 0 8px ${c}55` };
}

// Значок у ника: свой эмодзи (ур.13) либо ⛽ (ур.2) — эмодзи из Twemoji
export function CompBadge({ user, size = 11 }: { user?: CosUser | null; size?: number }) {
  const emoji = user?.comp_extra?.badge_emoji;
  if (!emoji && !user?.comp_badge) return null;
  return (
    <span
      title={`Гандолиум · уровень ${user?.comp_max_level ?? "?"}`}
      style={{ marginLeft: 4, display: "inline-flex", verticalAlign: "-0.05em", fontSize: size }}
    >{emoji ? <Emoji e={emoji} /> : <Gas size={size} />}</span>
  );
}

// Звезда легенды (ур.30) — после ника
export function CompStar({ user, size = 11 }: { user?: CosUser | null; size?: number }) {
  if (!user?.comp_extra?.star) return null;
  return (
    <span title="Легенда Гандолиума — 30-й уровень" style={{ marginLeft: 3, display: "inline-flex", verticalAlign: "-0.05em", fontSize: size }}>
      <Emoji e="⭐" />
    </span>
  );
}

// Титул под ником: свой (ур.19) важнее заработанного (ур.4). Золотой —
// потому что заработан.
export function titleOf(u?: CosUser | null): string | null {
  return u?.comp_extra?.custom_title || u?.comp_title || null;
}

export function CompTitle({ user, size = 11, center }: { user?: CosUser | null; size?: number; center?: boolean }) {
  const t = titleOf(user);
  if (!t) return null;
  return (
    <span style={{
      display: "block",
      fontSize: size,
      color: "#ffd24a",
      fontFamily: "var(--font-mono)",
      letterSpacing: "0.03em",
      textAlign: center ? "center" : undefined,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}>
      «{t}»
    </span>
  );
}

// Подиумные рамки финала сезона (место 1/2/3 в любом сезоне).
export const PODIUM_FRAMES: Record<string, { color: string; glow: string; label: string }> = {
  gold:   { color: "#ffd24a", glow: "rgba(255,210,74,0.5)",  label: "🥇 Золото" },
  silver: { color: "#c0c6cf", glow: "rgba(192,198,207,0.5)", label: "🥈 Серебро" },
  bronze: { color: "#cd7f32", glow: "rgba(205,127,50,0.5)",  label: "🥉 Бронза" },
};

// Стиль рамки аватарки. animated/legend дополняются css-классами
// (keyframes живут в global.css — inline-стили анимацию не умеют).
export function frameStyle(u?: Pick<UserOut, "comp_frame"> | null): React.CSSProperties {
  if (u?.comp_frame === "lime") {
    return { border: `2.5px solid ${FRAME_LIME}`, boxShadow: "0 0 12px rgba(198,255,61,0.45)" };
  }
  if (u?.comp_frame === "animated") {
    return { border: "2.5px solid #c6ff3d" }; // цвет крутит css-анимация
  }
  if (u?.comp_frame === "legend") {
    return { border: `2.5px solid ${FRAME_LEGEND}` }; // пульс крутит css-анимация
  }
  const podium = u?.comp_frame ? PODIUM_FRAMES[u.comp_frame] : undefined;
  if (podium) {
    return { border: `2.5px solid ${podium.color}`, boxShadow: `0 0 12px ${podium.glow}` };
  }
  return {};
}

export function frameClass(u?: Pick<UserOut, "comp_frame"> | null): string {
  if (u?.comp_frame === "animated") return "comp-frame-animated";
  if (u?.comp_frame === "legend") return "comp-frame-legend";
  return "";
}
