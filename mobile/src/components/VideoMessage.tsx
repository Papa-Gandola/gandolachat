import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "../theme";

interface Props {
  uri: string;
  name?: string | null;
  mine: boolean;
}

// Инлайн-видео в пузыре — как голосовые (VoiceMessage), только с картинкой.
//
// Плеер (expo-video: ExoPlayer на андроиде, <video> в PWA) монтируется
// ТОЛЬКО по тапу: десяток загруженных роликов в ленте — это десять
// декодеров и трафик впустую. До тапа — тёмная плашка с ▶ и именем файла.
// Ширина 240 (в 78% пузыря влезает даже на узком телефоне), высота — по
// реальному соотношению сторон (размер дорожки из sourceLoad/videoTrack;
// в вебе expo-video дорожки не отдаёт — остаётся 16:9 с contain), пока не
// известно — 16:9; вертикальные ролики с телефона ограничены 320 по высоте.
// Перемотка требует HTTP Range от сервера — его отдаёт наша ручка /uploads.
const W = 240;
const MAX_H = 320;

export function VideoMessage({ uri, name, mine }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);
  const [error, setError] = useState(false);

  let w = W;
  let h = Math.round(W / ratio);
  if (h > MAX_H) {
    h = MAX_H;
    w = Math.round(MAX_H * ratio);
  }
  const fg = mine ? theme.colors.bubbleMineText : theme.colors.accent;

  if (!open || error) {
    return (
      <Pressable
        onPress={() => {
          setError(false);
          setOpen(true);
        }}
        style={{
          width: w,
          height: h,
          borderRadius: 8,
          backgroundColor: "rgba(0,0,0,0.35)",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 6,
        }}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: mine ? "rgba(10,10,10,0.35)" : theme.colors.bgElevH,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: fg, fontSize: 20, marginLeft: 3 }}>▶</Text>
        </View>
        <Text
          numberOfLines={1}
          style={{
            position: "absolute",
            left: 8,
            right: 8,
            bottom: 6,
            fontFamily: theme.fonts.mono,
            fontSize: 10,
            color: "rgba(255,255,255,0.8)",
          }}
        >
          {error ? "не удалось воспроизвести — ещё раз" : name || "видео"}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={{ width: w, height: h, borderRadius: 8, overflow: "hidden", backgroundColor: "#000", marginBottom: 6 }}>
      <InlinePlayer uri={uri} width={w} height={h} onRatio={setRatio} onError={() => setError(true)} />
    </View>
  );
}

// Отдельный компонент: useVideoPlayer — хук, а плеер нужен только после
// тапа. Плеер освобождается вместе с компонентом (useReleasingSharedObject).
function InlinePlayer({
  uri,
  width,
  height,
  onRatio,
  onError,
}: {
  uri: string;
  width: number;
  height: number;
  onRatio: (r: number) => void;
  onError: () => void;
}) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.play();
  });

  useEffect(() => {
    const applySize = (size: { width: number; height: number } | undefined | null) => {
      if (size?.width && size?.height) onRatio(size.width / size.height);
    };
    const subLoad = player.addListener("sourceLoad", (e) => {
      applySize(e.availableVideoTracks?.[0]?.size);
    });
    const subStatus = player.addListener("statusChange", (e) => {
      if (e.status === "error") onError();
      if (e.status === "readyToPlay") applySize(player.videoTrack?.size);
    });
    return () => {
      subLoad.remove();
      subStatus.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  return (
    <VideoView
      player={player}
      style={{ width, height }}
      contentFit="contain"
      nativeControls
      // TextureView: SurfaceView не режется скруглением пузыря на андроиде
      surfaceType="textureView"
    />
  );
}
