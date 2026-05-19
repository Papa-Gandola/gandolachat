import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { StubScreen } from "../../components/StubScreen";
import { ChatsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ChatsStackParamList, "GroupChat">;

export function GroupChatScreen({ navigation, route }: Props) {
  return (
    <StubScreen
      title={route.params.name}
      note="Групповая переписка с avatar-ленточкой авторов сверху каждого сообщения."
      onBack={() => navigation.goBack()}
    />
  );
}
