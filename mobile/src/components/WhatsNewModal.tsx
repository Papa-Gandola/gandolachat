import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { CHANGELOG, CHANGELOG_ID, CHANGELOG_TITLE } from "../changelog";
import { useAuth } from "../services/AuthContext";
import * as SecureStore from "../services/secureStorage";
import { useTheme } from "../theme";

const KEY = "gandola.changelogSeen";

/**
 * «Что нового» после обновления: показывается один раз, когда сохранённая
 * метка отстаёт от CHANGELOG_ID (src/changelog.ts). Свежая установка окошко
 * не видит — только реальные обновления. Само окно — ChangelogModal ниже,
 * его же открывают руками из настроек («Что нового») и с экрана
 * «Обновления».
 */
export function WhatsNewModal() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        const seen = await SecureStore.getItemAsync(KEY);
        if (seen === CHANGELOG_ID) return;
        // Показываем и когда метки ещё нет: отличить свежую установку от
        // «обновился в релиз, где фича дебютирует» нельзя — проверка на
        // null молча съела дебютный показ у всех.
        if (alive && CHANGELOG.length > 0) setVisible(true);
      } catch {
        // не критично — покажем в следующий раз
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const close = () => {
    setVisible(false);
    SecureStore.setItemAsync(KEY, CHANGELOG_ID).catch(() => {});
  };

  return <ChangelogModal visible={visible} onClose={close} />;
}

/** Окно со списком изменений текущей версии. */
export function ChangelogModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            maxHeight: "80%",
            backgroundColor: theme.colors.bg,
            borderRadius: theme.decorate ? 0 : 14,
            borderWidth: 1,
            borderColor: theme.decorate ? theme.colors.accent : theme.colors.border,
            padding: 20,
          }}
        >
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 16, fontWeight: "700", color: theme.colors.accent, marginBottom: 14 }}>
            {theme.decorate ? `// ${CHANGELOG_TITLE}` : CHANGELOG_TITLE}
          </Text>
          <ScrollView style={{ flexGrow: 0 }}>
            {CHANGELOG.map((line, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, lineHeight: 19, color: theme.colors.inkDim }}>
                  {i + 1})
                </Text>
                <Text style={{ flex: 1, fontFamily: theme.fonts.mono, fontSize: 13, lineHeight: 19, color: theme.colors.ink }}>
                  {line}
                </Text>
              </View>
            ))}
          </ScrollView>
          <Pressable
            onPress={onClose}
            style={{
              marginTop: 14,
              backgroundColor: theme.colors.accent,
              borderRadius: theme.decorate ? 0 : 8,
              paddingVertical: 11,
              alignItems: "center",
            }}
          >
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 14, fontWeight: "700", color: theme.colors.accentText }}>
              Понятно
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
