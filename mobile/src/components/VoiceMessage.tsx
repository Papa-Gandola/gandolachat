import { Audio, AVPlaybackStatus } from "expo-av";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "../theme";

interface Props {
  uri: string;
  mine: boolean;
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

// Voice-message player: play/pause + a progress bar + elapsed/total time.
export function VoiceMessage({ uri, mine }: Props) {
  const theme = useTheme();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const onStatus = (st: AVPlaybackStatus) => {
    if (!st.isLoaded) return;
    setPosMs(st.positionMillis);
    if (st.durationMillis) setDurMs(st.durationMillis);
    if (st.didJustFinish) {
      // Stop at the end — no auto-rewind (rewinding here used to restart
      // playback, making the clip loop forever). Tap play to listen again.
      setPlaying(false);
      return;
    }
    setPlaying(st.isPlaying);
  };

  const toggle = async () => {
    try {
      if (!soundRef.current) {
        setLoading(true);
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true, isLooping: false },
          onStatus,
        );
        soundRef.current = sound;
        setLoading(false);
        setPlaying(true);
        return;
      }
      if (playing) {
        await soundRef.current.pauseAsync();
        return;
      }
      // If we're at (or past) the end, replay from the start; otherwise resume.
      if (durMs > 0 && posMs >= durMs - 50) {
        await soundRef.current.replayAsync();
      } else {
        await soundRef.current.playAsync();
      }
    } catch {
      setLoading(false);
    }
  };

  const progress = durMs > 0 ? Math.min(1, posMs / durMs) : 0;
  const fg = mine ? theme.colors.bubbleMineText : theme.colors.accent;
  const track = mine ? "rgba(10,10,10,0.25)" : theme.colors.border;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 180, paddingVertical: 2 }}>
      <Pressable
        onPress={toggle}
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: mine ? "rgba(10,10,10,0.18)" : theme.colors.bgElevH,
        }}
      >
        <Text style={{ color: fg, fontSize: 15 }}>{loading ? "…" : playing ? "❚❚" : "▶"}</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: track, overflow: "hidden" }}>
          <View style={{ width: `${progress * 100}%`, height: "100%", backgroundColor: fg }} />
        </View>
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 10,
            color: mine ? "rgba(10,10,10,0.55)" : theme.colors.inkMuted,
            marginTop: 4,
          }}
        >
          {fmt(posMs)} {durMs ? `/ ${fmt(durMs)}` : ""}
        </Text>
      </View>
    </View>
  );
}
