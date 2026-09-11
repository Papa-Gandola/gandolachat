import React from "react";
import { UserOut } from "../services/api";

// Косметика Гандолиума: помощники отображения. Данные приходят в UserOut
// (comp_*), живые обновления — через profile_updated.

export const FRAME_LIME = "#c6ff3d";

// Цвет ника: только если игрок выбрал (и сервер разрешил — валидация там)
export function nameColor(u?: Pick<UserOut, "comp_color"> | null): string | null {
  return u?.comp_color || null;
}

// Маленький ⛽ рядом с ником (разблокировка ур.2)
export function CompBadge({ user, size = 11 }: { user?: Pick<UserOut, "comp_badge" | "comp_max_level"> | null; size?: number }) {
  if (!user?.comp_badge) return null;
  return (
    <span
      title={`Гандолиум · уровень ${user.comp_max_level ?? "?"}`}
      style={{ fontSize: size, marginLeft: 4, verticalAlign: "baseline" }}
    >⛽</span>
  );
}

// Титул под ником (ур.4). Золотой — потому что заработан.
export function CompTitle({ user, size = 11, center }: { user?: Pick<UserOut, "comp_title"> | null; size?: number; center?: boolean }) {
  if (!user?.comp_title) return null;
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
      «{user.comp_title}»
    </span>
  );
}

// Подиумные рамки финала сезона (место 1/2/3 в любом сезоне).
export const PODIUM_FRAMES: Record<string, { color: string; glow: string; label: string }> = {
  gold:   { color: "#ffd24a", glow: "rgba(255,210,74,0.5)",  label: "🥇 Золото" },
  silver: { color: "#c0c6cf", glow: "rgba(192,198,207,0.5)", label: "🥈 Серебро" },
  bronze: { color: "#cd7f32", glow: "rgba(205,127,50,0.5)",  label: "🥉 Бронза" },
};

// Стиль рамки аватарки. animated дополняется css-классом comp-frame-animated
// (keyframes живут в global.css — inline-стили анимацию не умеют).
export function frameStyle(u?: Pick<UserOut, "comp_frame"> | null): React.CSSProperties {
  if (u?.comp_frame === "lime") {
    return { border: `2.5px solid ${FRAME_LIME}`, boxShadow: "0 0 12px rgba(198,255,61,0.45)" };
  }
  if (u?.comp_frame === "animated") {
    return { border: "2.5px solid #c6ff3d" }; // цвет крутит css-анимация
  }
  const podium = u?.comp_frame ? PODIUM_FRAMES[u.comp_frame] : undefined;
  if (podium) {
    return { border: `2.5px solid ${podium.color}`, boxShadow: `0 0 12px ${podium.glow}` };
  }
  return {};
}

export function frameClass(u?: Pick<UserOut, "comp_frame"> | null): string {
  return u?.comp_frame === "animated" ? "comp-frame-animated" : "";
}
