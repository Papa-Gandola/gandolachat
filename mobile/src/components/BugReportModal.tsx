import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import { apiErrorMessage, userApi } from "../services/api";
import { bugReportMeta, getLogText } from "../services/logBuffer";
import { useTheme } from "../theme";

// «Нашёл баг, отправить логи» (просьба хозяина 02.10): описание словами +
// хвост консоли уходят на сервер, тот кладёт файл в ЛС админу. Пользователю
// ничего выкачивать и пересылать не надо.
export function BugReportModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await userApi.sendBugReport({ note: note.trim(), log: getLogText(), meta: bugReportMeta() });
      setDone(res.data.file_name);
      setNote("");
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setDone(null);
    setErr(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable onPress={close} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: theme.colors.bgElev, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: 16, gap: 10 }}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: theme.colors.ink }}>🐞 Нашёл баг</Text>
          {done ? (
            <>
              <Text style={{ fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.ink, lineHeight: 19 }}>
                Ушло. Логи лежат файлом в личке у хозяина ({done}), он сам разберётся. Спасибо!
              </Text>
              <Pressable onPress={close} style={{ alignSelf: "flex-end", paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.sm, backgroundColor: theme.colors.accent }}>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "800", color: theme.colors.accentText }}>ОК</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.inkDim, lineHeight: 17 }}>
                Что случилось и что делал перед этим? Хвост логов приложения приложится сам и уйдёт файлом хозяину в личку.
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Например: нажал «Присоединиться» к звонку, а звука нет"
                placeholderTextColor={theme.colors.inkMuted}
                multiline
                maxLength={500}
                style={{ minHeight: 84, textAlignVertical: "top", fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.ink, backgroundColor: theme.colors.bg, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, padding: 10 }}
              />
              {err ? <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.danger }}>{err}</Text> : null}
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <Pressable onPress={close} disabled={busy} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border }}>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkDim }}>Отмена</Text>
                </Pressable>
                <Pressable onPress={send} disabled={busy} accessibilityLabel="Отправить логи" style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.sm, backgroundColor: theme.colors.accent, opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "800", color: theme.colors.accentText }}>{busy ? "ОТПРАВЛЯЮ…" : "ОТПРАВИТЬ ЛОГИ"}</Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
