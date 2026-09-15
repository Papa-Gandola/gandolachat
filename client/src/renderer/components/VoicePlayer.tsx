import React, { useEffect, useRef, useState } from "react";

// Инлайн-плеер голосовых (и любого аудио-вложения) прямо в пузыре.
//
// Цвета берём из currentColor: пузырь уже задаёт цвет текста (свой —
// var(--accent-text), чужой — var(--text-primary)), и плеер автоматически
// подходит под обе темы и оба вида пузырей без своей палитры.
//
// Голосовые с телефона — m4a (AAC). Официальные сборки Electron идут с
// проприетарными кодеками (H.264/AAC), так что <audio> их играет сам.
// Chromium у стримящегося m4a может отдать duration=Infinity до полной
// загрузки — до первого честного значения показываем «–:––».

const SPEEDS = [1, 1.5, 2] as const;

// Играет только одно голосовое разом — как на телефоне: запустил новое,
// предыдущее встало на паузу.
let current: HTMLAudioElement | null = null;

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "–:––";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VoicePlayer({ src, name, voice, isNeo }: {
  src: string;
  name?: string | null;
  /** true — голосовое (без имени файла), false — обычный аудиофайл (имя показываем) */
  voice: boolean;
  isNeo: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number>(NaN);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    a.src = src;
    audioRef.current = a;
    const onTime = () => setTime(a.currentTime);
    const onDur = () => setDuration(a.duration);
    const onEnd = () => {
      setPlaying(false);
      setTime(0);
      a.currentTime = 0;
      if (current === a) current = null;
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onErr = () => setError(true);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("durationchange", onDur);
    a.addEventListener("ended", onEnd);
    a.addEventListener("pause", onPause);
    a.addEventListener("play", onPlay);
    a.addEventListener("error", onErr);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("durationchange", onDur);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("error", onErr);
      if (current === a) current = null;
      a.src = "";
    };
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      return;
    }
    if (current && current !== a) current.pause();
    current = a;
    a.playbackRate = SPEEDS[speedIdx];
    void a.play().catch(() => setError(true));
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    const el = trackRef.current;
    if (!a || !el || !Number.isFinite(duration) || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
    setTime(a.currentTime);
  };

  const progress = Number.isFinite(duration) && duration > 0 ? Math.min(1, time / duration) : 0;
  const radius = isNeo ? 0 : 10;

  if (error) {
    return (
      <a href={src} target="_blank" rel="noreferrer" style={{ color: "currentColor", opacity: 0.85, fontSize: 13 }}>
        📎 {name || "аудио"} (не удалось воспроизвести — открыть)
      </a>
    );
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        minWidth: 240,
        maxWidth: 340,
        padding: "6px 10px 6px 6px",
        marginTop: 4,
        borderRadius: radius,
        background: "rgba(0,0,0,0.14)",
        color: "currentColor",
        userSelect: "none",
      }}
    >
      <button
        onClick={toggle}
        title={playing ? "Пауза" : "Слушать"}
        style={{
          width: 32,
          height: 32,
          borderRadius: isNeo ? 0 : 16,
          border: "1.5px solid currentColor",
          background: playing ? "currentColor" : "transparent",
          color: "inherit",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
          padding: 0,
        }}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ mixBlendMode: "difference" }}>
            <rect x="1.5" y="1" width="3.2" height="10" fill="#fff" />
            <rect x="7.3" y="1" width="3.2" height="10" fill="#fff" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <polygon points="2.5,1 11,6 2.5,11" fill="currentColor" />
          </svg>
        )}
      </button>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
        {!voice && name && (
          <span style={{ fontSize: 11.5, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            🎵 {name}
          </span>
        )}
        <div
          ref={trackRef}
          onClick={seek}
          title="Перемотать"
          style={{ position: "relative", height: 14, cursor: "pointer", display: "flex", alignItems: "center" }}
        >
          <div style={{ position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, background: "currentColor", opacity: 0.25 }} />
          <div style={{ position: "absolute", left: 0, width: `${progress * 100}%`, height: 4, borderRadius: 2, background: "currentColor" }} />
          <div
            style={{
              position: "absolute",
              left: `calc(${progress * 100}% - 5px)`,
              width: 10,
              height: 10,
              borderRadius: isNeo ? 0 : 5,
              background: "currentColor",
              opacity: playing || time > 0 ? 1 : 0,
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontFamily: "var(--font-mono)", opacity: 0.85 }}>
          <span>{voice ? "🎤 " : ""}{fmt(time)} / {fmt(duration)}</span>
          <button
            onClick={cycleSpeed}
            title="Скорость"
            style={{
              background: "transparent",
              border: "1px solid currentColor",
              color: "inherit",
              borderRadius: isNeo ? 0 : 6,
              fontSize: 10.5,
              fontFamily: "var(--font-mono)",
              padding: "1px 6px",
              cursor: "pointer",
              opacity: speedIdx === 0 ? 0.7 : 1,
            }}
          >
            {SPEEDS[speedIdx]}×
          </button>
        </div>
      </div>
    </div>
  );
}
