import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Image, Pressable, View } from "react-native";

import { CloseIcon } from "../../components/icons";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ChatsStackParamList, "MediaViewer">;

export function MediaViewerScreen({ navigation, route }: Props) {
  const { url } = route.params;
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
    </ScreenContainer>
  );
}
