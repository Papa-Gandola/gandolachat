import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { useVideoPlayer, VideoView } from "expo-video";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CloseIcon } from "../../components/icons";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "MediaViewer">;

export function MediaViewerScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { url, video } = route.params;
  const [saving, setSaving] = useState(false);

  const save = async () => {
    // PWA: галереи и файловой системы нет (expo-media-library на вебе —
    // стаб, см. metro.config.js) — открываем оригинал в новой вкладке,
    // дальше «сохранить как» средствами браузера.
    if (Platform.OS === "web") {
      window.open(url, "_blank", "noopener");
      return;
    }
    setSaving(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Нет доступа", "Разреши доступ к галерее в настройках Android.");
        return;
      }
      const name = url.split("/").pop() || `gandola_${Date.now()}.jpg`;
      // Новый API expo-file-system (SDK 54+): объект File вместо строк-путей.
      // Повторное сохранение того же файла — downloadFileAsync не
      // перезаписывает, поэтому старую копию в кэше сносим.
      const dest = new File(Paths.cache, name);
      if (dest.exists) dest.delete();
      const dl = await File.downloadFileAsync(url, dest);
      // Asset.create — новый класс-API. Старый saveToLibraryAsync в SDK 57
      // только ругается deprecation-ошибкой и ничего не сохраняет.
      await MediaLibrary.Asset.create(dl.uri);
      Alert.alert("Сохранено", video ? "Видео сохранено в галерею." : "Фото сохранено в галерею.");
    } catch (err) {
      Alert.alert("Не удалось сохранить", err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenContainer edgeToEdge>
      {/* Контент занимает всё над футером, а кнопка «Сохранить» живёт В
          ФУТЕРЕ, не оверлеем: абсолютная кнопка накрывала дорожку
          перемотки у нативных контролов видео — на середину было не
          перемотать. Футер с отступом под системную полосу (edge-to-edge). */}
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        {video ? (
          <FullScreenVideo url={url} />
        ) : (
          <Image source={{ uri: url }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
        )}
      </View>
      <View
        style={{
          backgroundColor: "#000",
          paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 12) + 4,
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={save}
          disabled={saving}
          style={{
            paddingHorizontal: 20,
            paddingVertical: 10,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accent,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minWidth: 160,
            justifyContent: "center",
          }}
        >
          {saving ? (
            <ActivityIndicator size="small" color={theme.colors.accentText} />
          ) : (
            <Text style={{ fontFamily: theme.fonts.mono, fontWeight: "700", color: theme.colors.accentText }}>
              СОХРАНИТЬ
            </Text>
          )}
        </Pressable>
      </View>
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={8}
        style={{
          position: "absolute",
          top: Math.max(insets.top, 24) + 8,
          right: 16,
          padding: 8,
          borderRadius: 20,
          backgroundColor: "rgba(0,0,0,0.45)",
        }}
      >
        <CloseIcon color="#fff" />
      </Pressable>
    </ScreenContainer>
  );
}

// Полноэкранный плеер: НАТИВНЫЕ контролы (пауза, перемотка, громкость) и
// кнопка «на весь экран» — здесь им никто не мешает, в отличие от ленты
// сообщений с её жестами. Перемотка требует HTTP Range от сервера — его
// отдаёт наша ручка /uploads.
function FullScreenVideo({ url }: { url: string }) {
  const player = useVideoPlayer({ uri: url }, (p) => {
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={{ width: "100%", height: "100%" }}
      contentFit="contain"
      nativeControls
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture={false}
    />
  );
}
