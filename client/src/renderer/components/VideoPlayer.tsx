import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

// Инлайн-видео прямо в пузыре (как голосовые — VoicePlayer, только картинка).
//
// Плеер — штатный <video controls>: Chromium в Electron идёт с
// проприетарными кодеками (H.264/AAC), так что mp4/mov с телефона играют
// сами; HEVC с айфонов — только если у видеокарты есть аппаратный декодер.
// Перемотка требует HTTP Range от сервера — его отдаёт наша ручка /uploads
// (uploads_static.py), не StaticFiles. Что не заиграло — ссылка «открыть».
//
// Играет одно видео разом (и ставит на паузу предыдущее) — как у голосовых.
let current: HTMLVideoElement | null = null;

const MAX_W = 420;
const MAX_H = 320;

export function VideoPlayer({ src, name, isNeo }: {
  src: string;
  name?: string | null;
  isNeo: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState(false);
  // width/height ролика — известно после loadedmetadata; до этого 16:9.
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onPlay = () => {
      if (current && current !== v) current.pause();
      current = v;
    };
    const onMeta = () => {
      if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
    };
    const onErr = () => setError(true);
    v.addEventListener("play", onPlay);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("error", onErr);
    return () => {
      v.pause();
      if (current === v) current = null;
      v.removeEventListener("play", onPlay);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("error", onErr);
    };
  }, [src]);

  if (error) {
    return (
      <a href={src} target="_blank" rel="noreferrer" style={{ color: "currentColor", opacity: 0.85, fontSize: 13 }}>
        <Icon name="film" size={13} style={{ marginRight: 4 }} />{name || "видео"} (не удалось воспроизвести — открыть)
      </a>
    );
  }

  // Не шире 420 и не выше 320: горизонтальные ролики — по ширине,
  // вертикальные с телефона — по высоте (иначе занимали бы весь экран).
  const r = ratio ?? 16 / 9;
  let w = MAX_W;
  if (Math.round(w / r) > MAX_H) w = Math.round(MAX_H * r);

  return (
    <div
      // Двойной клик по строке сообщения открывает «Ответить» — клики по
      // контролам плеера его вызывать не должны.
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ marginTop: 4, maxWidth: "100%" }}
    >
      <video
        ref={ref}
        src={src}
        controls
        preload="metadata"
        playsInline
        title={name || undefined}
        style={{
          display: "block",
          width: w,
          maxWidth: "100%",
          aspectRatio: String(r),
          background: "#000",
          borderRadius: isNeo ? 0 : 10,
          outline: "none",
        }}
      />
      {name && (
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 3, maxWidth: w, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <Icon name="film" size={11} style={{ marginRight: 4 }} />{name}
        </div>
      )}
    </div>
  );
}
