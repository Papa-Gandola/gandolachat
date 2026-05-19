import { ReactNode } from "react";
import { Text, View } from "react-native";

import { useTheme } from "../theme";
import { AppBar } from "./AppBar";
import { ChevronLeftIcon } from "./icons";
import { IconBtn } from "./IconBtn";
import { ScreenContainer } from "./ScreenContainer";

interface Props {
  title: string;
  note?: string;
  onBack?: () => void;
  extra?: ReactNode;
}

// Placeholder screen — shows the title bar and a "// TODO" marker. Used for
// screens that exist in the design but haven't been implemented yet.
export function StubScreen({ title, note, onBack, extra }: Props) {
  const theme = useTheme();
  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? `// ${title.toUpperCase()}` : title}
        left={
          onBack ? (
            <IconBtn onPress={onBack}>
              <ChevronLeftIcon color={theme.colors.ink} />
            </IconBtn>
          ) : undefined
        }
      />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            color: theme.colors.inkMuted,
            fontSize: 12,
            letterSpacing: 1.2,
            marginBottom: 8,
          }}
        >
          {theme.decorate ? "// СТРАНИЦА_В_РАЗРАБОТКЕ" : "Страница в разработке"}
        </Text>
        {note ? (
          <Text
            style={{
              fontFamily: theme.fonts.body,
              color: theme.colors.inkDim,
              fontSize: 13,
              textAlign: "center",
              maxWidth: 280,
              lineHeight: 19,
            }}
          >
            {note}
          </Text>
        ) : null}
        {extra}
      </View>
    </ScreenContainer>
  );
}
