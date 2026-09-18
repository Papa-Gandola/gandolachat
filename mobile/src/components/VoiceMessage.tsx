import { AudioPlayer, AudioStatus, createAudioPlayer, setAudioModeAsync } from "expo-audio";
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

// Only one voice message should play at a time. When a player starts, it
// pauses whichever was playing before (Telegram-style).
let activePause: (() => void) | null = null;
// Все живые плееры (не только играющий): перед записью голосового их надо
// выгрузить целиком — см. комментарий у unloadSelf ниже.
const liveUnloads = new Set<() => void>();

export function unloadAllVoicePlayers() {
  liveUnloads.forEach((fn) => fn());
}

// Voice-message player: play/pause + a progress bar + elapsed/total time.
//
// Плеер — expo-audio (SDK 57; раньше expo-av Sound). Создаём его
// ИМПЕРАТИВНО (createAudioPlayer) и только по тапу: хук useAudioPlayer
// грузил бы каждое голосовое ленты сразу при рендере.
export function VoiceMessage({ uri, mine }: Props) {
  const theme = useTheme();
  const playerRef = useRef<AudioPlayer | null>(null);
  const subRef = useRef<{ remove: () => void } | null>(null);
  // Дошли до конца: следующий play должен начать сначала (ExoPlayer после
  // конца дорожки на play() сам не перематывает).
  const finishedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);
  const [loading, setLoading] = useState(false);

  // Stable pause handle (created once) this player registers as the active one.
  const pauseSelf = useRef(() => {
    try {
      playerRef.current?.pause();
    } catch {
      // уже выгружен
    }
    setPlaying(false);
  }).current;

  // Регистрируем и «полный сброс»: перед ЗАПИСЬЮ голосового загруженный
  // плеер надо не просто поставить на паузу, а выгрузить — на части
  // андроидов живой плеер держит аудио-сессию и prepare записи падает
  // (после чего запись клинит навсегда).
  const unloadSelf = useRef(() => {
    const p = playerRef.current;
    playerRef.current = null;
    subRef.current?.remove();
    subRef.current = null;
    setPlaying(false);
    if (p) {
      try {
        p.pause();
      } catch {
        // ignore
      }
      try {
        p.remove();
      } catch {
        // ignore
      }
    }
  }).current;

  useEffect(() => {
    liveUnloads.add(unloadSelf);
    return () => {
      liveUnloads.delete(unloadSelf);
      if (activePause === pauseSelf) activePause = null;
      unloadSelf();
    };
  }, [pauseSelf, unloadSelf]);

  const onStatus = (st: AudioStatus) => {
    if (!st.isLoaded) return;
    setPosMs(Math.max(0, Math.round(st.currentTime * 1000)));
    if (st.duration && Number.isFinite(st.duration)) setDurMs(Math.round(st.duration * 1000));
    if (st.didJustFinish) {
      // Stop at the end — no auto-rewind (rewinding here used to restart
      // playback, making the clip loop forever). Tap play to listen again.
      finishedRef.current = true;
      setPlaying(false);
      return;
    }
    setPlaying(st.playing);
  };

  const beginPlay = () => {
    // Pause any other voice message that's currently playing.
    if (activePause && activePause !== pauseSelf) activePause();
    activePause = pauseSelf;
    finishedRef.current = false;
    setPlaying(true);
  };

  const toggle = async () => {
    try {
      if (!playerRef.current) {
        setLoading(true);
        await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
        const p = createAudioPlayer({ uri }, { updateInterval: 250 });
        playerRef.current = p;
        subRef.current = p.addListener("playbackStatusUpdate", onStatus);
        p.play();
        setLoading(false);
        beginPlay();
        return;
      }
      const p = playerRef.current;
      if (playing) {
        p.pause();
        setPlaying(false);
        return;
      }
      // If we're at (or past) the end, replay from the start; otherwise resume.
      if (finishedRef.current || (durMs > 0 && posMs >= durMs - 50)) {
        await p.seekTo(0);
      }
      p.play();
      beginPlay();
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
