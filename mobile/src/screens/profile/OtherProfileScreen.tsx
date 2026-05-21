import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { ScreenContainer } from "../../components/ScreenContainer";
import { Section } from "../../components/Section";
import { ChatsStackParamList } from "../../navigation/types";
import { apiErrorMessage, UserOut, userApi } from "../../services/api";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "OtherProfile">;

function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return "давно";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "давно";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  return `${d.getDate()}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

export function OtherProfileScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const { userId } = route.params;
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await userApi.getUser(userId);
        if (alive) setUser(res.data);
      } catch (err) {
        if (alive) setError(apiErrorMessage(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <ScreenContainer>
      <AppBar
        title=""
        left={
          <IconBtn onPress={() => navigation.goBack()}>
            <ChevronLeftIcon color={theme.colors.ink} />
          </IconBtn>
        }
      />

      {loading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : error ? (
        <View style={{ padding: 24, alignItems: "center" }}>
          <Text style={{ fontFamily: theme.fonts.mono, color: theme.colors.danger, fontSize: 12 }}>
            {theme.decorate ? `! ${error}` : error}
          </Text>
        </View>
      ) : user ? (
        <ScrollView style={{ flex: 1 }}>
          <View
            style={{
              alignItems: "center",
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 20,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Avatar letter={(user.username[0] ?? "?").toUpperCase()} size={104} bg="#ef5350" uri={user.avatar_url} />
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 18,
                fontWeight: "700",
                color: theme.colors.ink,
                marginTop: 12,
              }}
            >
              {user.username}
            </Text>
            {user.status ? (
              <Text
                style={{
                  fontFamily: theme.fonts.body,
                  fontSize: 13,
                  color: theme.colors.inkDim,
                  marginTop: 8,
                  textAlign: "center",
                  maxWidth: 280,
                  lineHeight: 19,
                }}
              >
                {user.status}
              </Text>
            ) : null}
          </View>

          <Section>ИНФО</Section>
          <InfoRow k="никнейм" v={`@${user.username}`} />
          <InfoRow k="последний визит" v={formatLastSeen(user.last_seen)} />
          {user.is_admin ? <InfoRow k="роль" v="админ" /> : null}

          {user.about ? (
            <>
              <Section>О СЕБЕ</Section>
              <Text
                style={{
                  paddingHorizontal: 16,
                  paddingBottom: 16,
                  fontSize: 13,
                  color: theme.colors.inkDim,
                  lineHeight: 20,
                  fontFamily: theme.fonts.body,
                }}
              >
                {user.about}
              </Text>
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </ScreenContainer>
  );
}

function InfoRow({ k, v }: { k: string; v: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 10,
            color: theme.colors.inkMuted,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontWeight: "700",
          }}
        >
          {k}
        </Text>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.ink, marginTop: 2 }}>
          {v}
        </Text>
      </View>
    </View>
  );
}
