import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CameraType, CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { CloseIcon } from "../../components/icons";
import { ChatsStackParamList } from "../../navigation/types";
import { apiErrorMessage, chatApi } from "../../services/api";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "Camera">;

// In-app camera (expo-camera / CameraX) — opens instantly, unlike the system
// camera intent which was taking minutes on the user's device.
export function CameraScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const { chatId } = route.params;
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [busy, setBusy] = useState(false);

  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: "#fff", fontFamily: theme.fonts.body, fontSize: 14, textAlign: "center", marginBottom: 16 }}>
          Нужен доступ к камере, чтобы снять фото.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.accent }}
        >
          <Text style={{ fontFamily: theme.fonts.mono, fontWeight: "700", color: theme.colors.accentText }}>
            РАЗРЕШИТЬ
          </Text>
        </Pressable>
        <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
          <Text style={{ color: theme.colors.inkDim, fontFamily: theme.fonts.mono }}>Назад</Text>
        </Pressable>
      </View>
    );
  }

  const capture = async () => {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo?.uri) return;
      await chatApi.uploadFile(Number(chatId), {
        uri: photo.uri,
        name: `camera_${Date.now()}.jpg`,
        type: "image/jpeg",
      });
      navigation.goBack();
    } catch (err) {
      Alert.alert("Не удалось снять фото", apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing} />

      {/* Close */}
      <Pressable onPress={() => navigation.goBack()} style={{ position: "absolute", top: 44, left: 16, padding: 8 }}>
        <CloseIcon color="#fff" size={26} />
      </Pressable>

      {/* Controls */}
      <View
        style={{
          position: "absolute",
          bottom: 40,
          left: 0,
          right: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
        }}
      >
        <View style={{ width: 52 }} />
        <Pressable
          onPress={capture}
          disabled={busy}
          style={{
            width: 74,
            height: 74,
            borderRadius: 37,
            borderWidth: 5,
            borderColor: "#fff",
            backgroundColor: busy ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.85)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {busy ? <ActivityIndicator color="#000" /> : null}
        </Pressable>
        <Pressable
          onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: "rgba(0,0,0,0.4)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 22 }}>🔄</Text>
        </Pressable>
      </View>
    </View>
  );
}
