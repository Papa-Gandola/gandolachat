import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { StubScreen } from "../../components/StubScreen";
import { ChatsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ChatsStackParamList, "StickerPicker">;

export function StickerPickerScreen({ navigation }: Props) {
  return (
    <StubScreen
      title="Стикеры и эмодзи"
      note="Кастомный эмодзи-пак Gandola + системные эмодзи."
      onBack={() => navigation.goBack()}
    />
  );
}
