import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { StubScreen } from "../../components/StubScreen";
import { ChatsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ChatsStackParamList, "NewGroup">;

export function NewGroupScreen({ navigation }: Props) {
  return <StubScreen title="Новая группа" onBack={() => navigation.goBack()} />;
}
