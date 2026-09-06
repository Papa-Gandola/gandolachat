import React from "react";

// rank_tier из OpenDota: десятки — медаль (1..8), единицы — звёзды (1..5).
// Например 54 = Легенда ★4, 80 = Титан.
const MEDALS = [
  { name: "Рекрут", color: "#9c8d7c" },
  { name: "Страж", color: "#7fa5b5" },
  { name: "Крестоносец", color: "#b58a4e" },
  { name: "Властелин", color: "#c9d4dc" },
  { name: "Легенда", color: "#a78bda" },
  { name: "Древний", color: "#64b1e4" },
  { name: "Божество", color: "#f0c04a" },
  { name: "Титан", color: "#ff6a5e" },
];

export function rankLabel(rankTier: number | null | undefined, leaderboardRank?: number | null): string | null {
  if (!rankTier) return null;
  const medal = Math.floor(rankTier / 10);
  const stars = rankTier % 10;
  if (medal < 1 || medal > 8) return null;
  const m = MEDALS[medal - 1];
  if (medal === 8) {
    return leaderboardRank ? `${m.name} #${leaderboardRank}` : m.name;
  }
  return stars > 0 ? `${m.name} ${"★".repeat(Math.min(stars, 5))}` : m.name;
}

export default function DotaRankBadge({ rankTier, leaderboardRank, isNeo, size = "md" }: {
  rankTier: number | null | undefined;
  leaderboardRank?: number | null;
  isNeo?: boolean;
  size?: "sm" | "md";
}) {
  if (!rankTier) return null;
  const medal = Math.floor(rankTier / 10);
  if (medal < 1 || medal > 8) return null;
  const m = MEDALS[medal - 1];
  const label = rankLabel(rankTier, leaderboardRank);
  const sm = size === "sm";
  return (
    <span
      title={`Звание в Dota 2: ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: sm ? "1px 7px" : "3px 10px",
        fontSize: sm ? 11 : 13,
        fontWeight: 700,
        letterSpacing: isNeo ? "0.04em" : undefined,
        fontFamily: isNeo ? "var(--font-mono)" : undefined,
        color: m.color,
        border: `1px solid ${m.color}`,
        borderRadius: isNeo ? 0 : 999,
        background: `${m.color}1a`,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ fontSize: sm ? 10 : 12 }}>⚔</span>
      {label}
    </span>
  );
}
