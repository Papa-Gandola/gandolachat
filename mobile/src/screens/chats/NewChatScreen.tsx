import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { StubScreen } from "../../components/StubScreen";
import { ChatsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ChatsStackParamList, "NewChat">;

export function NewChatScreen({ navigation }: Props) {
  return <StubScreen title="Новый чат" onBack={() => navigation.goBack()} />;
}
