import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, Text, View } from "react-native";

import { CloseIcon } from "../../components/icons";
import { ScreenContainer } from "../../components/ScreenContainer";
import { CallsStackParamList } from "../../navigation/types";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<CallsStackParamList, "ActiveCall">;

export function ActiveCallScreen({ navigation }: Props) {
  const theme = useTheme();
  return (
    <ScreenContainer edgeToEdge>
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: theme.colors.inkDim, fontFamily: theme.fonts.mono, fontSize: 14 }}>
          {theme.decorate ? "// ВИДЕОЗВОНОК" : "Видеозвонок"}
        </Text>
        <Text
          style={{
            color: theme.colors.inkMuted,
            fontFamily: theme.fonts.body,
            fontSize: 12,
            marginTop: 8,
          }}
        >
          react-native-webrtc подключим на этапе 5
        </Text>
      </View>
      <Pressable
        onPress={() => navigation.goBack()}
        style={{
          position: "absolute",
          bottom: 50,
          alignSelf: "center",
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: theme.colors.danger,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CloseIcon color="#fff" size={28} />
      </Pressable>
    </ScreenContainer>
  );
}
