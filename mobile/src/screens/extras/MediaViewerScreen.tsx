import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, Text, View } from "react-native";

import { CloseIcon } from "../../components/icons";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "MediaViewer">;

export function MediaViewerScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const { url } = route.params;
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Нет доступа", "Разреши доступ к галерее в настройках Android.");
        return;
      }
      const name = url.split("/").pop() || `gandola_${Date.now()}.jpg`;
      const dest = `${FileSystem.cacheDirectory}${name}`;
      const dl = await FileSystem.downloadAsync(url, dest);
      await MediaLibrary.saveToLibraryAsync(dl.uri);
      Alert.alert("Сохранено", "Фото сохранено в галерею.");
    } catch (err) {
      Alert.alert("Не удалось сохранить", err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenContainer edgeToEdge>
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <Image source={{ uri: url }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
      </View>
      <Pressable
        onPress={() => navigation.goBack()}
        style={{ position: "absolute", top: 40, right: 16, padding: 8 }}
      >
        <CloseIcon color="#fff" />
      </Pressable>
      <Pressable
        onPress={save}
        disabled={saving}
        style={{
          position: "absolute",
          bottom: 40,
          alignSelf: "center",
          paddingHorizontal: 20,
          paddingVertical: 10,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.accent,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
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
    </ScreenContainer>
  );
}
