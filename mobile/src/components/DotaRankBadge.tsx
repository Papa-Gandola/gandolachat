import { Text, View } from "react-native";

import { useTheme } from "../theme";

// rank_tier из OpenDota: десятки — медаль (1..8), единицы — звёзды.
// Зеркало десктопного client/src/renderer/components/DotaRankBadge.tsx.
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

export function rankLabel(rankTier?: number | null, leaderboardRank?: number | null): string | null {
  if (!rankTier) return null;
  const medal = Math.floor(rankTier / 10);
  const stars = rankTier % 10;
  if (medal < 1 || medal > 8) return null;
  const m = MEDALS[medal - 1];
  if (medal === 8) return leaderboardRank ? `${m.name} #${leaderboardRank}` : m.name;
  return stars > 0 ? `${m.name} ${"★".repeat(Math.min(stars, 5))}` : m.name;
}

export function DotaRankBadge({ rankTier, leaderboardRank, small }: {
  rankTier?: number | null;
  leaderboardRank?: number | null;
  small?: boolean;
}) {
  const theme = useTheme();
  if (!rankTier) return null;
  const medal = Math.floor(rankTier / 10);
  if (medal < 1 || medal > 8) return null;
  const m = MEDALS[medal - 1];
  const label = rankLabel(rankTier, leaderboardRank);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: small ? 7 : 10,
        paddingVertical: small ? 2 : 4,
        borderWidth: 1,
        borderColor: m.color,
        borderRadius: theme.radius.sm,
        backgroundColor: `${m.color}22`,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ fontSize: small ? 9 : 11 }}>⚔</Text>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: small ? 10.5 : 12.5, fontWeight: "700", color: m.color }}>
        {label}
      </Text>
    </View>
  );
}
