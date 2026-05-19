import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { Label } from "../../components/Label";
import { ScreenContainer } from "../../components/ScreenContainer";
import { Section } from "../../components/Section";
import { ProfileStackParamList } from "../../navigation/types";
import { useTheme, useThemeControls } from "../../theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "Settings">;

export function SettingsScreen({ navigation }: Props) {
  const theme = useTheme();
  const { themeId, setThemeId } = useThemeControls();

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? "// НАСТРОЙКИ" : "Настройки"}
        left={
          <IconBtn onPress={() => navigation.goBack()}>
            <ChevronLeftIcon color={theme.colors.ink} />
          </IconBtn>
        }
      />

      <Section>ВНЕШНИЙ ВИД</Section>

      <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        <Label variant="field">ТЕМА</Label>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <ThemeChoice
            label="Neo Venezia"
            sub="лайм / моно / сканлайны"
            active={themeId === "neo"}
            onPress={() => setThemeId("neo")}
          />
          <ThemeChoice
            label="Discord"
            sub="синий / sans / без декора"
            active={themeId === "discord"}
            onPress={() => setThemeId("discord")}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

function ThemeChoice({
  label,
  sub,
  active,
  onPress,
}: {
  label: string;
  sub: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        padding: 14,
        backgroundColor: active ? theme.colors.bgElevH : theme.colors.bgElev,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent : theme.colors.border,
        borderRadius: theme.radius.md,
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 13,
          fontWeight: "700",
          color: active ? theme.colors.accent : theme.colors.ink,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 10,
          color: theme.colors.inkDim,
          marginTop: 4,
          letterSpacing: 0.6,
        }}
      >
        {sub}
      </Text>
    </Pressable>
  );
}
