import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { StubScreen } from "../../components/StubScreen";
import { ChatsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ChatsStackParamList, "ChatInfo">;

export function ChatInfoScreen({ navigation }: Props) {
  return (
    <StubScreen
      title="Инфо о группе"
      note="Аватар, описание, участники, общие файлы, ссылки и медиа."
      onBack={() => navigation.goBack()}
    />
  );
}
