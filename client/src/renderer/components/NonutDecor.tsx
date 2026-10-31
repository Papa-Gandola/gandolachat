import React from "react";

// «Недрочабрь» в Гандолиуме (ноябрь, /me.theme === "nonut"): счётчик
// «Держишься N дней» и календарь месяца с крестиками по дням срыва. Срыв —
// катка с 10+ смертями (считает сервер: /me.abstinence). Кладётся отдельной
// панелью над шапкой прогресса; на телефоне — тот же блок (NonutDecor.tsx в
// mobile). Выбор хозяина 31.10 вместо паутины октября.

export interface AbstinenceStats {
  days: number;           // дней с последнего срыва (без срывов — с 1-го числа)
  slips: number[];        // номера дней месяца со срывом
  today: number;          // сегодняшнее число (МСК)
  days_in_month: number;
  games: number;
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const SLIP = "#ff3d3d";

export default function NonutDecor({
  stats, isNeo, mono, panelStyle,
}: {
  stats: AbstinenceStats;
  isNeo: boolean;
  mono: React.CSSProperties;
  panelStyle: React.CSSProperties;
}) {
  const slips = new Set(stats.slips);
  const cells = Array.from({ length: stats.days_in_month }, (_, i) => i + 1);
  const cell = (d: number): React.CSSProperties => {
    const isSlip = slips.has(d);
    const isToday = d === stats.today;
    const future = d > stats.today;
    return {
      width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: isSlip || isToday ? 800 : 500, boxSizing: "border-box",
      borderRadius: isNeo ? 0 : 5,
      border: `1px solid ${isSlip ? SLIP : isToday ? "var(--accent)" : future ? "var(--border)" : "var(--accent)"}`,
      background: isSlip ? "rgba(255,61,61,0.16)" : isToday ? "var(--accent)" : "transparent",
      color: isSlip ? SLIP : isToday ? "var(--accent-text)" : future ? "var(--text-muted)" : "var(--accent)",
      opacity: future ? 0.55 : 1,
      ...mono,
    };
  };
  return (
    <div style={{ ...panelStyle, display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 170 }}>
        <span style={{ ...mono, fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.08em" }}>
          {isNeo ? "// НЕДРОЧАБРЬ" : "НЕДРОЧАБРЬ"} · ДЕРЖИШЬСЯ
        </span>
        <span style={{ ...mono, fontSize: 30, fontWeight: 800, color: stats.slips.length && stats.days === 0 ? SLIP : "var(--accent)", lineHeight: 1 }}>
          {stats.days}
          <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 7, color: "var(--text-secondary)" }}>
            {plural(stats.days, "день", "дня", "дней")}
          </span>
        </span>
        <span style={{ ...mono, fontSize: 11, color: "var(--text-muted)" }}>
          {stats.slips.length
            ? `${stats.slips.length} ${plural(stats.slips.length, "срыв", "срыва", "срывов")} за месяц`
            : "без срывов"} · срыв = 10+ смертей за катку
        </span>
      </div>
      <div
        title="Календарь ноября: ✕ — день со срывом"
        style={{ display: "grid", gridTemplateColumns: "repeat(10, 26px)", gap: 4 }}
      >
        {cells.map((d) => (
          <div key={d} style={cell(d)} title={slips.has(d) ? `${d} ноября — срыв` : `${d} ноября`}>
            {slips.has(d) ? "✕" : d}
          </div>
        ))}
      </div>
    </div>
  );
}
