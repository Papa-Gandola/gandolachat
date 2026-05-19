import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { ActiveCallScreen } from "../screens/calls/ActiveCallScreen";
import { CallsListScreen } from "../screens/calls/CallsListScreen";
import { CallsStackParamList } from "./types";

const Stack = createNativeStackNavigator<CallsStackParamList>();

export function CallsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CallsList" component={CallsListScreen} />
      <Stack.Screen
        name="ActiveCall"
        component={ActiveCallScreen}
        options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
      />
    </Stack.Navigator>
  );
}
