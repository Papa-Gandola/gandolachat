import { Text, View } from "react-native";

import { useTheme } from "../theme";
import type { AbstinenceStats } from "../services/api";

// «Недрочабрь» в Гандолиуме (ноябрь, /me.theme === "nonut"): счётчик
// «Держишься N дней» и календарь месяца с крестиками по дням срыва (срыв —
// катка с 10+ смертями, считает сервер: /me.abstinence). Тот же блок, что
// на десктопе (components/NonutDecor.tsx). Едет по OTA.

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const SLIP = "#ff3d3d";

export function NonutDecor({ stats }: { stats: AbstinenceStats }) {
  const theme = useTheme();
  const slips = new Set(stats.slips);
  const cells = Array.from({ length: stats.days_in_month }, (_, i) => i + 1);
  const zero = stats.slips.length > 0 && stats.days === 0;
  return (
    <View
      style={{
        marginHorizontal: 14, marginBottom: 14, padding: 14, gap: 10,
        backgroundColor: theme.colors.bgElev, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <View style={{ gap: 2 }}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, color: theme.colors.inkMuted, letterSpacing: 1 }}>
            {theme.decorate ? "// НЕДРОЧАБРЬ" : "НЕДРОЧАБРЬ"} · ДЕРЖИШЬСЯ
          </Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 28, fontWeight: "800", color: zero ? SLIP : theme.colors.accent, lineHeight: 32 }}>
            {stats.days}
            <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.inkDim }}>  {plural(stats.days, "день", "дня", "дней")}</Text>
          </Text>
        </View>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted, textAlign: "right", maxWidth: 150 }}>
          {stats.slips.length
            ? `${stats.slips.length} ${plural(stats.slips.length, "срыв", "срыва", "срывов")} за месяц`
            : "без срывов"}
          {"\n"}срыв = 10+ смертей
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {cells.map((d) => {
          const isSlip = slips.has(d);
          const isToday = d === stats.today;
          const future = d > stats.today;
          const border = isSlip ? SLIP : future ? theme.colors.border : theme.colors.accent;
          const color = isSlip ? SLIP : isToday ? theme.colors.bg : future ? theme.colors.inkMuted : theme.colors.accent;
          return (
            <View
              key={d}
              accessibilityLabel={isSlip ? `${d} ноября — срыв` : `${d} ноября`}
              style={{
                width: 26, height: 26, alignItems: "center", justifyContent: "center",
                borderWidth: 1, borderColor: border, borderRadius: theme.decorate ? 0 : 5,
                backgroundColor: isSlip ? "rgba(255,61,61,0.16)" : isToday ? theme.colors.accent : "transparent",
                opacity: future ? 0.55 : 1,
              }}
            >
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, fontWeight: isSlip || isToday ? "800" : "500", color }}>
                {isSlip ? "✕" : d}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
