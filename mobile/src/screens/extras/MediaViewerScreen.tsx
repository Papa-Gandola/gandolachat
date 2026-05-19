import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, Text, View } from "react-native";

import { CloseIcon } from "../../components/icons";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "MediaViewer">;

export function MediaViewerScreen({ navigation }: Props) {
  const theme = useTheme();
  return (
    <ScreenContainer edgeToEdge>
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: theme.colors.inkDim, fontFamily: theme.fonts.mono }}>
          {theme.decorate ? "// МЕДИА_ПРОСМОТРЩИК" : "Медиа просмотрщик"}
        </Text>
      </View>
      <Pressable
        onPress={() => navigation.goBack()}
        style={{ position: "absolute", top: 40, right: 16, padding: 8 }}
      >
        <CloseIcon color="#fff" />
      </Pressable>
    </ScreenContainer>
  );
}
