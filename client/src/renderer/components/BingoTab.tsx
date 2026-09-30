import React from "react";
import { CompendiumBingoCell } from "../services/api";
import Icon, { Gas } from "./Icon";

const GOLD = "#ffd24a";
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };

// «Бинго» тайных ачивок (просьба хозяина 01.10): сетка на все пасхалки.
// Клетка открывается, когда триггернул — тогда видно название и за что.
// Закрытые — только номер и замок: сервер им ни имени, ни описания не
// отдаёт. Таблица только своя: в чужом профиле её нет.
export function BingoTab({ isNeo, cells }: { isNeo: boolean; cells?: CompendiumBingoCell[] }) {
  const panel: React.CSSProperties = {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: isNeo ? 0 : 8,
    padding: 14,
  };
  if (!cells) {
    return (
      <div style={panel}>
        <p style={{ ...mono, color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
          Сервер ещё не обновлён — клетки появятся после деплоя
        </p>
      </div>
    );
  }
  const opened = cells.filter((c) => c.open).length;
  const all = cells.length > 0 && opened === cells.length;
  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <span style={{ ...mono, color: "var(--accent)", fontWeight: 700, fontSize: 12.5, letterSpacing: "0.1em" }}>// БИНГО ТАЙНЫХ</span>
        <span style={{ ...mono, fontSize: 11.5, color: all ? GOLD : "var(--text-muted)", fontWeight: all ? 800 : 400 }}>
          {all ? "БИНГО! все пасхалки твои" : `открыто ${opened} из ${cells.length}`}
        </span>
      </div>
      <p style={{ ...mono, color: "var(--text-muted)", fontSize: 11.5, margin: "0 0 12px" }}>
        Клетка открывается, когда триггернёшь пасхалку — тогда и узнаешь, за что она. Таблица только твоя: другие видят лишь свои.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
        {cells.map((c) =>
          c.open ? (
            <div
              key={c.id}
              title={c.desc}
              style={{
                minHeight: 122, padding: "10px 10px 8px", display: "flex", flexDirection: "column", gap: 4,
                background: "rgba(255,210,74,0.10)", border: `1px solid ${GOLD}`, borderRadius: isNeo ? 0 : 8,
                boxShadow: "0 0 12px rgba(255,210,74,0.18)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: GOLD }}>
                <Icon name="unlock" size={15} />
                <span style={{ ...mono, fontSize: 10, letterSpacing: "0.1em", opacity: 0.85 }}>#{c.num}</span>
                <span style={{ ...mono, marginLeft: "auto", fontWeight: 800, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}>
                  +{c.gas} <Gas size={12} />
                </span>
              </div>
              <div style={{ ...mono, fontWeight: 700, fontSize: 12.5, color: GOLD, lineHeight: 1.25 }}>{c.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.3, flex: 1 }}>{c.desc}</div>
              <div style={{ ...mono, fontSize: 10, color: "var(--text-muted)" }}>
                {c.first_at ? new Date(c.first_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : ""}
                {(c.count ?? 1) > 1 ? ` · ${c.count} раз(а)` : ""}
                {c.title ? ` · титул «${c.title}»` : ""}
              </div>
            </div>
          ) : (
            <div
              key={c.id}
              title="Тайное — узнаешь, когда триггернёшь"
              style={{
                minHeight: 122, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                background: "var(--bg-tertiary)", border: "1px dashed var(--border)", borderRadius: isNeo ? 0 : 8,
                color: "var(--text-muted)",
              }}
            >
              <Icon name="lock" size={18} />
              <span style={{ ...mono, fontSize: 11, letterSpacing: "0.1em" }}>#{c.num}</span>
              <span style={{ ...mono, fontSize: 10, opacity: 0.7 }}>???</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
