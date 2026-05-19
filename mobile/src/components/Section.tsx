import { ReactNode } from "react";
import { View } from "react-native";

import { Label } from "./Label";

interface Props {
  children: string;
  right?: ReactNode;
}

export function Section({ children, right }: Props) {
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Label variant="section">{children}</Label>
      {right ? <View style={{ marginLeft: "auto" }}>{right}</View> : null}
    </View>
  );
}
