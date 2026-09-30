import { useState } from "react";
import { LayoutChangeEvent, Pressable, Text, View } from "react-native";

import { CompendiumBingoCell } from "../../services/api";
import { useTheme } from "../../theme";

const GOLD = "#ffd24a";
const COLS = 4;
const GAP = 8;

// «Бинго» тайных ачивок (просьба хозяина 01.10): сетка на все пасхалки,
// клетка открывается, когда триггернул — тогда видно название и за что.
// Закрытые — только номер и замок: сервер им ни имени, ни описания не отдаёт.
// Таблица только своя (в чужом профиле её нет). Тап по открытой — подробности
// под сеткой (в клетке 4×5 на телефоне описание не помещается).
export function BingoGrid({ cells }: { cells?: CompendiumBingoCell[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  if (!cells) {
    return (
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkMuted }}>
        Сервер ещё не обновлён — клетки появятся после деплоя
      </Text>
    );
  }
  const size = width > 0 ? Math.floor((width - GAP * (COLS - 1)) / COLS) : 0;
  const opened = cells.filter((c) => c.open).length;
  const all = cells.length > 0 && opened === cells.length;
  const sel = cells.find((c) => c.id === selected && c.open) ?? null;

  return (
    <View style={{ gap: 10 }} onLayout={(e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: theme.colors.accent, letterSpacing: 1 }}>
          {theme.decorate ? "// БИНГО ТАЙНЫХ" : "БИНГО ТАЙНЫХ"}
        </Text>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: all ? GOLD : theme.colors.inkMuted, fontWeight: all ? "800" : "400" }}>
          {all ? "БИНГО! все открыты" : `открыто ${opened} из ${cells.length}`}
        </Text>
      </View>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted, lineHeight: 15 }}>
        Клетка открывается, когда триггернёшь пасхалку — тогда и узнаешь, за что. Таблица только твоя. Тап по открытой — подробности.
      </Text>
      {size > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
          {cells.map((c) => {
            const isSel = sel?.id === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => c.open && setSelected(isSel ? null : c.id)}
                accessibilityLabel={c.open ? `Открыто: ${c.name}` : `Закрытая клетка ${c.num}`}
                style={{
                  width: size,
                  height: size,
                  borderRadius: theme.radius.sm,
                  padding: 6,
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: c.open ? "rgba(255,210,74,0.14)" : theme.colors.bgElev,
                  borderWidth: isSel ? 2 : 1,
                  borderStyle: c.open ? "solid" : "dashed",
                  borderColor: c.open ? GOLD : theme.colors.border,
                }}
              >
                {c.open ? (
                  <>
                    <Text style={{ fontSize: 16 }}>🔓</Text>
                    <Text numberOfLines={2} style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, fontWeight: "700", color: GOLD, textAlign: "center", marginTop: 3 }}>
                      {c.name}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={{ fontSize: 16, opacity: 0.5 }}>🔒</Text>
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, color: theme.colors.inkMuted, marginTop: 3 }}>#{c.num}</Text>
                  </>
                )}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {sel ? (
        <View style={{ padding: 10, borderRadius: theme.radius.sm, backgroundColor: "rgba(255,210,74,0.12)", borderWidth: 1, borderColor: GOLD, gap: 3 }}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12.5, fontWeight: "700", color: GOLD }}>
            🔓 {sel.name}
            {sel.title ? <Text style={{ fontSize: 10.5 }}>  титул «{sel.title}»</Text> : null}
          </Text>
          <Text style={{ fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.ink, lineHeight: 17 }}>{sel.desc}</Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted }}>
            +{sel.gas} ⛽ · впервые{" "}
            {sel.first_at ? new Date(sel.first_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "—"}
            {(sel.count ?? 1) > 1 ? ` · ${sel.count} раз(а)` : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
