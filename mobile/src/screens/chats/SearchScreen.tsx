import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { StubScreen } from "../../components/StubScreen";
import { ChatsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ChatsStackParamList, "Search">;

export function SearchScreen({ navigation }: Props) {
  return <StubScreen title="Поиск" note="Полнотекстовый поиск по чатам и сообщениям." onBack={() => navigation.goBack()} />;
}
