import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { StubScreen } from "../../components/StubScreen";
import { ChatsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ChatsStackParamList, "OtherProfile">;

export function OtherProfileScreen({ navigation }: Props) {
  return (
    <StubScreen title="Профиль" note="Профиль другого пользователя." onBack={() => navigation.goBack()} />
  );
}
