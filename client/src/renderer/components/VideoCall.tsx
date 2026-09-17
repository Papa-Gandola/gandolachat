import React, { useEffect, useRef, useState } from "react";
import { ChatOut, UserOut } from "../services/api";
import { webrtcService } from "../services/webrtc";
import { wsService } from "../services/ws";
import { playCallRing, playCallEndSound } from "../services/sounds";
import { useTheme } from "../services/theme";
import Icon from "./Icon";

interface Props {
  chat: ChatOut;
  currentUser: UserOut;
  initiator: boolean;
  // Кто реально начал звонок (из call_signal). Без него responder целился в
  // «первого участника чата» — в группах слот занимал не тот юзер.
  initiatorUserId?: number | null;
  // Подключение к уже идущему созвону (не по входящему звонку): call_join +
  // mesh по call_active, оффера нам никто не шлёт.
  joinExisting?: boolean;
  onEnd: () => void;
}

interface VideoEntry {
  userId: number;
  stream: MediaStream;
}

function neoCtrl(activeColor?: string): React.CSSProperties {
  return {
    borderRadius: 0,
    border: `1.5px solid ${activeColor || "var(--accent)"}`,
    boxShadow: activeColor ? `0 0 8px ${activeColor}55` : undefined,
  };
}

export default function VideoCall({ chat, currentUser, initiator, initiatorUserId, joinExisting, onEnd }: Props) {
  const theme = useTheme();
  const isNeo = theme === "neo";
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [remoteVideos, setRemoteVideos] = useState<VideoEntry[]>([]);
  const [remoteScreens, setRemoteScreens] = useState<VideoEntry[]>([]);
  const [muted, setMuted] = useState(false);
  const WEBCAM_PREF_KEY = "gandola-cam-default";
  const [videoOff, setVideoOff] = useState(() => {
    const saved = localStorage.getItem(WEBCAM_PREF_KEY);
    return saved !== null ? saved === "true" : true;
  });
  const [deafened, setDeafened] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [screenSources, setScreenSources] = useState<any[] | null>(null);
  const [screenShareAudio, setScreenShareAudio] = useState(false);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const [minimized, setMinimized] = useState(false);
  const [miniPos, setMiniPos] = useState(() => {
    try {
      const raw = localStorage.getItem("callMiniPos");
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.x === "number" && typeof p.y === "number") return p;
      }
    } catch {}
    return { x: window.innerWidth - 280 - 16, y: window.innerHeight - 60 - 80, w: 280, h: 52 };
  });
  const [callStartTime] = useState(Date.now());
  const [callDuration, setCallDuration] = useState("00:00");
  const [freeMode, setFreeMode] = useState(false);
  const [tilePositions, setTilePositions] = useState<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const [peerVolumes, setPeerVolumes] = useState<Map<number, number>>(new Map());
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [mutedPeers, setMutedPeers] = useState<Set<number>>(new Set());
  const [videoOffPeers, setVideoOffPeers] = useState<Set<number>>(new Set());
  const [screenSharingPeers, setScreenSharingPeers] = useState<Set<number>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [micGain, setMicGain] = useState(100);
  // "" = системный микрофон по умолчанию (как при входе в звонок).
  const [micDeviceId, setMicDeviceId] = useState<string>("");
  // Растёт при каждой смене микрофона — перезапускает анализатор «говорю»:
  // MediaStreamSource привязан к дорожке на момент создания, после
  // replaceTrack он читал остановленную старую и ободок гас навсегда.
  const [micEpoch, setMicEpoch] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [defaultMicLabel, setDefaultMicLabel] = useState<string>("");
  const [outputDeviceId, setOutputDeviceId] = useState<string>("");
  const [usingRelay, setUsingRelay] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const started = useRef(false);

  // Restore local video when un-minimized
  useEffect(() => {
    if (!minimized && localVideoRef.current) {
      const ls = webrtcService.getLocalStream();
      if (ls) localVideoRef.current.srcObject = ls;
    }
    if (!minimized && screenVideoRef.current && screenStream) {
      screenVideoRef.current.srcObject = screenStream;
    }
  }, [minimized]);

  useEffect(() => {
    if (screenVideoRef.current && screenStream) {
      screenVideoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

  // Listen for mute/video/screen status from other users
  useEffect(() => {
    const muteHandler = (data: any) => {
      setMutedPeers((prev) => {
        const next = new Set(prev);
        data.muted ? next.add(data.user_id) : next.delete(data.user_id);
        return next;
      });
    };
    const videoHandler = (data: any) => {
      setVideoOffPeers((prev) => {
        const next = new Set(prev);
        data.video_off ? next.add(data.user_id) : next.delete(data.user_id);
        return next;
      });
    };
    const screenHandler = (data: any) => {
      setScreenSharingPeers((prev) => {
        const next = new Set(prev);
        data.sharing ? next.add(data.user_id) : next.delete(data.user_id);
        return next;
      });
    };
    wsService.on("mute_status", muteHandler);
    wsService.on("video_status", videoHandler);
    wsService.on("screen_share_status", screenHandler);
    return () => {
      wsService.off("mute_status", muteHandler);
      wsService.off("video_status", videoHandler);
      wsService.off("screen_share_status", screenHandler);
    };
  }, []);

  // Call duration timer
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      const min = Math.floor(elapsed / 60);
      const sec = elapsed % 60;
      const hrs = Math.floor(min / 60);
      if (hrs > 0) {
        setCallDuration(`${hrs}:${(min % 60).toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`);
      } else {
        setCallDuration(`${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [callStartTime]);

  // Own voice activity detection
  useEffect(() => {
    const ls = webrtcService.getLocalStream();
    if (!ls) return;
    const ac = new AudioContext();
    const source = ac.createMediaStreamSource(ls);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const interval = setInterval(() => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setSelfSpeaking(avg > 15);
    }, 100);
    return () => { clearInterval(interval); ac.close(); };
  }, [remoteVideos.length, micEpoch]); // re-run when call connects / mic switched

  // Рефы для эффекта устройств ниже: его замыкание живёт от первого рендера.
  const micDeviceIdRef = useRef(micDeviceId);
  micDeviceIdRef.current = micDeviceId;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const micGainRef = useRef(micGain);
  micGainRef.current = micGain;

  // Load available devices (+ пересчитать, когда посреди звонка воткнули
  // гарнитуру — иначе её нет в списке до перезахода).
  useEffect(() => {
    const load = () => navigator.mediaDevices.enumerateDevices().then((devices) => {
      const inputs = devices.filter((d) => d.kind === "audioinput");
      // Виртуальные «default»/«communications» Chromium'а в список не кладём —
      // им соответствует пункт «По умолчанию» (audio: true); по их id после
      // смены устройства Windows отдавал немой трек. Подпись «Default - X»
      // используем, чтобы показать, какой это микрофон.
      const def = inputs.find((d) => d.deviceId === "default");
      setDefaultMicLabel(def?.label ? def.label.replace(/^default\s*-\s*/i, "") : "");
      setAudioDevices(inputs.filter((d) => d.deviceId !== "default" && d.deviceId !== "communications"));
      setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
      setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
      // Выбранный микрофон выдернули: его дорожка мертва (ended), а
      // контролируемый select визуально падал на «По умолчанию» — повторный
      // выбор того же пункта onChange не даёт, и все молчали бы до выбора
      // другого физического микрофона. Переходим на системный сами.
      const cur = micDeviceIdRef.current;
      if (cur && !inputs.some((d) => d.deviceId === cur)) {
        webrtcService.switchMicrophone("", { muted: mutedRef.current, gain: micGainRef.current })
          .then(() => {
            setMicDeviceId("");
            setMicEpoch((n) => n + 1);
            setMicError("Микрофон отключился — переключил на «По умолчанию»");
          })
          .catch(() => setMicError("Микрофон отключился, а запасной не отвечает — выбери другой"));
      }
    }).catch(() => {});
    load();
    navigator.mediaDevices.addEventListener?.("devicechange", load);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", load);
  }, []);

  // Poll WebRTC stats every 8 seconds to know whether any peer pair is going
  // through a TURN relay. Used to show a small "fallback servers in use" hint.
  useEffect(() => {
    if (remoteVideos.length === 0) { setUsingRelay(false); return; }
    let cancelled = false;
    const check = async () => {
      try {
        const { usingRelay: rel } = await webrtcService.getConnectionQuality();
        if (!cancelled) setUsingRelay(rel);
      } catch {}
    };
    check();
    const id = setInterval(check, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [remoteVideos.length, remoteScreens.length]);

  // Whenever a remote stream arrives, the new <video>/<audio> elements default to
  // the system output. If the user picked a specific output device, push it onto
  // every media element on the page so newcomers also play through the right speaker.
  useEffect(() => {
    if (!outputDeviceId) return;
    const apply = () => {
      document.querySelectorAll("video, audio").forEach((el: any) => {
        if (el.setSinkId && el.sinkId !== outputDeviceId) {
          el.setSinkId(outputDeviceId).catch(() => {});
        }
      });
    };
    apply();
    // Re-apply once more after a tick, in case a stream attached just after this render
    const t = setTimeout(apply, 200);
    return () => clearTimeout(t);
  }, [outputDeviceId, remoteVideos.length, remoteScreens.length]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    webrtcService.onStream = (userId, stream) => {
      setRemoteVideos((prev) => {
        const exists = prev.find((v) => v.userId === userId);
        if (exists) return prev.map((v) => v.userId === userId ? { ...v, stream } : v);
        return [...prev, { userId, stream }];
      });
    };

    webrtcService.onScreenStream = (userId, stream) => {
      setRemoteScreens((prev) => {
        const exists = prev.find((v) => v.userId === userId);
        if (exists) return prev.map((v) => v.userId === userId ? { ...v, stream } : v);
        return [...prev, { userId, stream }];
      });
    };

    webrtcService.onScreenEnded = (userId) => {
      setRemoteScreens((prev) => prev.filter((v) => v.userId !== userId));
    };

    webrtcService.onPeerLeft = (userId) => {
      setRemoteVideos((prev) => prev.filter((v) => v.userId !== userId));
      setRemoteScreens((prev) => prev.filter((v) => v.userId !== userId));
      // Let everyone still in the call hear the drop sound when someone leaves.
      playCallEndSound();
    };

    webrtcService.onCallEnded = () => {
      onEnd();
    };

    playCallRing();

    const memberIds = chat.members.map((m) => m.id);
    (async () => {
      let localStream: MediaStream;
      if (initiator) {
        localStream = await webrtcService.startCall(chat.id, memberIds, !videoOff);
      } else if (joinExisting) {
        localStream = await webrtcService.joinOngoing(chat.id, !videoOff);
      } else {
        const initiatorId = initiatorUserId ?? memberIds.find((id) => id !== currentUser.id)!;
        localStream = await webrtcService.joinCall(chat.id, initiatorId, !videoOff);
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
      if (videoOff) {
        wsService.send({ type: "video_status", chat_id: chat.id, video_off: true });
      }
    })();
  }, []);

  function handleEnd() {
    playCallEndSound();
    webrtcService.endCall();
    onEnd();
  }

  function toggleMute() {
    const newMuted = !muted;
    const stream = webrtcService.getLocalStream();
    stream?.getAudioTracks().forEach((t) => (t.enabled = !newMuted));
    setMuted(newMuted);
    wsService.send({ type: "mute_status", chat_id: chat.id, muted: newMuted });
  }

  async function toggleVideo() {
    const newVideoOff = !videoOff;
    try {
      if (newVideoOff) {
        webrtcService.disableVideo();
      } else {
        await webrtcService.enableVideo();
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = webrtcService.getLocalStream();
        }
      }
      setVideoOff(newVideoOff);
      localStorage.setItem(WEBCAM_PREF_KEY, String(newVideoOff));
      wsService.send({ type: "video_status", chat_id: chat.id, video_off: newVideoOff });
    } catch {
      // Camera acquisition failed — keep current state
    }
  }

  function toggleDeafen() {
    const newDeaf = !deafened;
    setDeafened(newDeaf);
    // Mute/unmute all remote audio (webcam + any screen audio)
    remoteVideos.forEach((entry) => {
      entry.stream.getAudioTracks().forEach((t) => (t.enabled = !newDeaf));
    });
    remoteScreens.forEach((entry) => {
      entry.stream.getAudioTracks().forEach((t) => (t.enabled = !newDeaf));
    });
  }

  async function toggleScreenShare() {
    if (screenSharing) {
      stopScreenShare();
    } else {
      // Show source picker
      const electron = (window as any).electron;
      if (electron?.getScreenSources) {
        const sources = await electron.getScreenSources();
        setScreenSources(sources);
      }
    }
  }

  async function startScreenShare(sourceId: string, withAudio: boolean) {
    setScreenSources(null);
    try {
      // Windows: Chromium supports capturing desktop audio alongside desktop video
      // when BOTH audio and video constraints use chromeMediaSource: "desktop".
      // audio-only constraint without video raises NotSupportedError on most OSes.
      const videoConstraint: any = {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
        },
      };
      const audioConstraint: any = withAudio ? {
        mandatory: {
          chromeMediaSource: "desktop",
          // No sourceId here — Electron uses the default desktop loopback on Windows
        },
      } : false;

      let stream: MediaStream;
      try {
        stream = await (navigator.mediaDevices as any).getUserMedia({
          audio: audioConstraint,
          video: videoConstraint,
        });
      } catch (err) {
        // Fallback: maybe OS refused loopback audio — retry video-only.
        if (withAudio) {
          console.warn("[screen] audio capture rejected, retrying without audio", err);
          stream = await (navigator.mediaDevices as any).getUserMedia({
            audio: false,
            video: videoConstraint,
          });
        } else {
          throw err;
        }
      }

      // Open a dedicated peer connection per member carrying the screen stream,
      // so remote peers see webcam AND screen simultaneously (two separate tiles).
      webrtcService.startScreenShare(stream);
      setScreenStream(stream);
      setScreenSharing(true);
      wsService.send({ type: "screen_share_status", chat_id: chat.id, sharing: true });
      const screenTrack = stream.getVideoTracks()[0];
      screenTrack.onended = () => stopScreenShare();
    } catch (err) {
      console.error("[screen] failed to start share", err);
    }
  }

  function stopScreenShare() {
    webrtcService.stopScreenShare();
    setScreenStream(null);
    setScreenSharing(false);
    wsService.send({ type: "screen_share_status", chat_id: chat.id, sharing: false });
  }

  function changePeerVolume(userId: number, volume: number) {
    setPeerVolumes((prev) => new Map(prev).set(userId, volume));
  }

  function getTilePos(id: string, index: number) {
    const saved = tilePositions.get(id);
    if (saved) return saved;
    return { x: 20 + (index % 3) * 300, y: 20 + Math.floor(index / 3) * 230, w: 280, h: 210 };
  }

  function startDrag(id: string, e: React.MouseEvent, mode: "move" | "resize") {
    if (!freeMode) return;
    e.stopPropagation();
    e.preventDefault();
    const tileEl = (e.currentTarget as HTMLElement).closest("[data-tile-id]") as HTMLElement | null;
    if (!tileEl) return;
    const startX = e.clientX;
    const startY = e.clientY;
    // Read actual rendered position from DOM so the first drag doesn't teleport
    // (tilePositions may not have an entry yet if the tile was never moved)
    const pos = tilePositions.get(id) ?? {
      x: parseFloat(tileEl.style.left) || 20,
      y: parseFloat(tileEl.style.top) || 20,
      w: parseFloat(tileEl.style.width) || 280,
      h: parseFloat(tileEl.style.height) || 210,
    };
    const videoEl = tileEl.querySelector("video") as HTMLVideoElement | null;
    const aspect = (videoEl && videoEl.videoWidth && videoEl.videoHeight)
      ? videoEl.videoWidth / videoEl.videoHeight
      : pos.w / pos.h;
    let lastFrame: number | null = null;
    let pendingPos = { ...pos };

    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (mode === "move") {
        pendingPos = { ...pos, x: pos.x + dx, y: pos.y + dy };
      } else {
        const newW = Math.max(160, pos.w + dx);
        pendingPos = { ...pos, w: newW, h: Math.max(90, Math.round(newW / aspect)) };
      }
      if (lastFrame === null) {
        lastFrame = requestAnimationFrame(() => {
          if (tileEl) {
            tileEl.style.left = pendingPos.x + "px";
            tileEl.style.top = pendingPos.y + "px";
            tileEl.style.width = pendingPos.w + "px";
            tileEl.style.height = pendingPos.h + "px";
          }
          lastFrame = null;
        });
      }
    };
    const onUp = () => {
      if (lastFrame !== null) cancelAnimationFrame(lastFrame);
      document.body.style.userSelect = "";
      setTilePositions((prev) => new Map(prev).set(id, pendingPos));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const callName = chat.is_group ? chat.name : chat.members.find((m) => m.id !== currentUser.id)?.username;

  function startMiniDrag(e: React.MouseEvent, mode: "move" | "resize") {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...miniPos };
    let last = { ...startPos };
    let raf: number | null = null;
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (mode === "move") {
        const maxX = window.innerWidth - last.w;
        const maxY = window.innerHeight - last.h;
        last = {
          ...startPos,
          x: Math.max(0, Math.min(maxX, startPos.x + dx)),
          y: Math.max(40, Math.min(maxY, startPos.y + dy)),
        };
      } else {
        const maxW = window.innerWidth - startPos.x - 4;
        const maxH = window.innerHeight - startPos.y - 4;
        last = {
          ...startPos,
          w: Math.max(180, Math.min(maxW, startPos.w + dx)),
          h: Math.max(44, Math.min(maxH, startPos.h + dy)),
        };
      }
      if (raf === null) {
        raf = requestAnimationFrame(() => { setMiniPos(last); raf = null; });
      }
    };
    const onUp = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      document.body.style.userSelect = "";
      setMiniPos(last);
      try { localStorage.setItem("callMiniPos", JSON.stringify(last)); } catch {}
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (minimized) {
    return (
      <>
        {/* Hidden audio elements to keep remote streams playing */}
        {remoteVideos.map((entry) => (
          <HiddenAudio key={entry.userId} stream={entry.stream} deafened={deafened} volume={peerVolumes.get(entry.userId) ?? 100} />
        ))}
        <div
          style={{
            position: "fixed",
            left: miniPos.x,
            top: miniPos.y,
            width: miniPos.w,
            height: miniPos.h,
            zIndex: 200,
            background: isNeo ? "#0a0a0a" : "#3ba55d",
            border: isNeo ? "1.5px solid var(--accent)" : "none",
            borderRadius: isNeo ? 0 : 8,
            boxShadow: isNeo ? "0 0 12px rgba(198,255,61,0.35)" : "0 4px 12px rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 14px",
            cursor: "move",
            userSelect: "none",
          }}
          onMouseDown={(e) => {
            // Skip drag if click started on a button or the resize corner
            const target = e.target as HTMLElement;
            if (target.closest("button") || target.closest("[data-mini-resize]")) return;
            startMiniDrag(e, "move");
          }}
          onDoubleClick={() => setMinimized(false)}
          title="Перетаскивай за панель • Двойной клик — развернуть • Правый нижний угол — ресайз"
        >
          <span style={{ ...s.miniText, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.05em" } : {}), flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            {isNeo ? (
              <><span style={{ animation: "neo-blink 1.2s infinite" }}>●</span> LIVE · {callName} · [{remoteVideos.length + 1}]</>
            ) : (
              <><Icon name="phone" size={13} style={{ marginRight: 5 }} />{callName} — {remoteVideos.length + 1}</>
            )}
            {usingRelay && <span title="Запасной сервер — соединение может быть хуже" style={{ marginLeft: 6, color: isNeo ? "var(--warning)" : "#faa61a", display: "inline-flex" }}><Icon name="warning" size={13} /></span>}
          </span>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              style={{ ...s.miniBtn, ...(isNeo ? { borderRadius: 0, border: "1px solid var(--border)", background: "transparent" } : {}) }}
              onClick={(e) => { e.stopPropagation(); toggleMute(); }}
              title={muted ? "Включить микрофон" : "Заглушить"}
            >
              <Icon name={muted ? "mic-off" : "mic"} size={16} strokeWidth={2} style={{ color: isNeo ? "var(--accent)" : "#fff" }} />
            </button>
            <button
              style={{ ...s.miniBtn, background: "transparent", border: "1px solid rgba(255,255,255,0.4)", ...(isNeo ? { borderRadius: 0, borderColor: "var(--accent)" } : {}) }}
              onClick={(e) => { e.stopPropagation(); setMinimized(false); }}
              title="Развернуть"
            >
              <Icon name="expand" size={14} strokeWidth={2.25} style={{ color: isNeo ? "var(--accent)" : "#fff" }} />
            </button>
            <button
              style={{ ...s.miniBtn, background: "#ed4245", ...(isNeo ? { borderRadius: 0 } : {}) }}
              onClick={(e) => { e.stopPropagation(); handleEnd(); }}
              title="Завершить"
            >
              <Icon name="end" size={17} strokeWidth={2} style={{ color: "#fff" }} />
            </button>
          </div>
          {/* Resize handle (bottom-right corner) */}
          <div
            data-mini-resize
            onMouseDown={(e) => startMiniDrag(e, "resize")}
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 14,
              height: 14,
              cursor: "nwse-resize",
              background: isNeo ? "var(--accent)" : "rgba(255,255,255,0.5)",
              clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
              opacity: 0.6,
            }}
          />
        </div>
      </>
    );
  }

  return (
    <div style={s.overlay}>
      <div style={s.header}>
        {isNeo ? (
          <>
            <span style={{ ...s.title, ...mono, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              <span style={{ animation: "neo-blink 1.2s infinite" }}>●</span> ПОДКЛЮЧЕНИЕ {callDuration}
            </span>
            <span style={{ ...s.subtitle, ...mono, letterSpacing: "0.08em" }}>&gt; {callName}</span>
          </>
        ) : (
          <>
            <span style={s.title}>Видеозвонок • {callDuration}</span>
            <span style={s.subtitle}>{callName}</span>
          </>
        )}
        {usingRelay && (
          <div
            title="Прямое соединение P2P не удалось установить — звонок идёт через TURN-сервер. Возможна задержка и потеря качества."
            style={{
              position: "absolute" as const,
              left: "50%",
              top: 38,
              transform: "translateX(-50%)",
              padding: "3px 10px",
              fontSize: 11,
              borderRadius: isNeo ? 0 : 12,
              background: isNeo ? "transparent" : "rgba(250, 166, 26, 0.15)",
              color: isNeo ? "var(--warning)" : "#faa61a",
              border: `1px solid ${isNeo ? "var(--warning)" : "rgba(250,166,26,0.5)"}`,
              fontFamily: isNeo ? "var(--font-mono)" : undefined,
              letterSpacing: isNeo ? "0.05em" : undefined,
              cursor: "help",
              whiteSpace: "nowrap" as const,
              userSelect: "none" as const,
            }}
          >
            {isNeo ? "// ⚠ запасной_сервер · соединение_может_быть_хуже" : <><Icon name="warning" size={13} style={{ marginRight: 5 }} />Запасной сервер — соединение может быть хуже</>}
          </div>
        )}
        <button
          style={{ ...s.minimizeBtn, ...(isNeo ? { borderRadius: 0, border: "1px solid var(--border)", background: "transparent", color: "var(--accent)" } : {}) }}
          onClick={() => setMinimized(true)}
          title="Свернуть"
        >
          <Icon name="collapse" size={16} strokeWidth={2.25} style={{ color: isNeo ? "var(--accent)" : "#fff" }} />
        </button>
      </div>

      <div style={freeMode ? s.videoGridFree : s.videoGrid}>
        {/* Local video */}
        {(() => {
          const pos = freeMode ? getTilePos("self", 0) : null;
          return (
            <div
              data-tile-id="self"
              style={{
                ...s.videoWrap,
                ...(!freeMode && enlarged === "self" ? s.enlarged : {}),
                ...(freeMode && pos ? { position: "absolute" as const, left: pos.x, top: pos.y, width: pos.w, height: pos.h } : {}),
                boxShadow: selfSpeaking && !muted ? (isNeo ? "0 0 0 2px var(--accent), 0 0 12px rgba(198,255,61,0.5)" : "0 0 0 3px #57f287") : "none",
                transition: freeMode ? "none" : "box-shadow 0.15s",
                cursor: freeMode ? "move" : "pointer",
                willChange: freeMode ? "left, top, width, height" : "auto",
                ...(isNeo ? { borderRadius: 0, border: "1px solid var(--border)" } : {}),
              }}
              onMouseDown={(e) => freeMode && startDrag("self", e, "move")}
              onClick={() => !freeMode && setEnlarged(enlarged === "self" ? null : "self")}
            >
              <video ref={localVideoRef} autoPlay muted playsInline style={{
                ...(freeMode ? { width: "100%", height: "100%", objectFit: "cover" as const, pointerEvents: "none" as const } : (enlarged === "self" ? s.videoEnlarged : s.video)),
                display: videoOff ? "none" : "block",
              }} />
              {videoOff && <CallAvatar name={currentUser.username} url={currentUser.avatar_url} isNeo={isNeo} />}
              {isNeo && <NeoCorners />}
              <span style={{ ...s.videoLabel, ...mono, ...(isNeo ? { background: "rgba(10,10,10,0.85)", color: "var(--accent)", borderRadius: 0, border: "1px solid var(--accent)", letterSpacing: "0.05em" } : {}) }}>
                {isNeo ? "@вы" : "Вы"}
              </span>
              {freeMode && <div style={s.resizeCorner} onMouseDown={(e) => startDrag("self", e, "resize")} />}
            </div>
          );
        })()}

        {/* Screen share tile */}
        {screenStream && (() => {
          const pos = freeMode ? getTilePos("screen", 1) : null;
          return (
            <div
              data-tile-id="screen"
              style={{
                ...s.videoWrap,
                ...(!freeMode && enlarged === "screen" ? s.enlarged : {}),
                ...(freeMode && pos ? { position: "absolute" as const, left: pos.x, top: pos.y, width: pos.w, height: pos.h } : {}),
                cursor: freeMode ? "move" : "pointer", border: "2px solid #5865f2",
                willChange: freeMode ? "left, top, width, height" : "auto",
                transition: freeMode ? "none" : "box-shadow 0.15s",
              }}
              onMouseDown={(e) => freeMode && startDrag("screen", e, "move")}
              onClick={() => !freeMode && setEnlarged(enlarged === "screen" ? null : "screen")}
            >
              <video ref={screenVideoRef} autoPlay muted playsInline style={freeMode ? { width: "100%", height: "100%", objectFit: "contain" as const, pointerEvents: "none" as const } : (enlarged === "screen" ? s.videoEnlarged : s.video)} />
              <span style={s.videoLabel}>Ваш экран</span>
              {freeMode && <div style={s.resizeCorner} onMouseDown={(e) => startDrag("screen", e, "resize")} />}
            </div>
          );
        })()}

        {/* Remote videos (webcams) */}
        {remoteVideos.map((entry, idx) => (
          <RemoteVideo
            key={`cam-${entry.userId}`}
            entry={entry}
            chat={chat}
            enlarged={enlarged === String(entry.userId)}
            deafened={deafened}
            peerMuted={mutedPeers.has(entry.userId)}
            peerVideoOff={videoOffPeers.has(entry.userId)}
            peerScreenSharing={false}
            volume={peerVolumes.get(entry.userId) ?? 100}
            onVolumeChange={(v) => changePeerVolume(entry.userId, v)}
            onClick={() => !freeMode && setEnlarged(enlarged === String(entry.userId) ? null : String(entry.userId))}
            freeMode={freeMode}
            freePos={freeMode ? getTilePos(`r${entry.userId}`, idx + 2) : null}
            onStartDrag={(e, mode) => startDrag(`r${entry.userId}`, e, mode)}
            isNeo={isNeo}
          />
        ))}

        {/* Remote screens — rendered as separate tiles in addition to webcams */}
        {remoteScreens.map((entry, idx) => {
          const screenKey = `screen-${entry.userId}`;
          const pos = freeMode ? getTilePos(screenKey, remoteVideos.length + idx + 2) : null;
          const member = chat.members.find((m) => m.id === entry.userId);
          return (
            <div
              key={screenKey}
              data-tile-id={screenKey}
              style={{
                ...s.videoWrap,
                ...(!freeMode && enlarged === screenKey ? s.enlarged : {}),
                ...(freeMode && pos ? { position: "absolute" as const, left: pos.x, top: pos.y, width: pos.w, height: pos.h } : {}),
                cursor: freeMode ? "move" : "pointer",
                border: isNeo ? "1px solid var(--accent)" : "2px solid #5865f2",
                ...(isNeo ? { borderRadius: 0 } : {}),
                willChange: freeMode ? "left, top, width, height" : "auto",
                transition: freeMode ? "none" : "box-shadow 0.15s",
              }}
              onMouseDown={(e) => freeMode && startDrag(screenKey, e, "move")}
              onClick={() => !freeMode && setEnlarged(enlarged === screenKey ? null : screenKey)}
            >
              <RemoteScreenVideo stream={entry.stream} freeMode={!!freeMode} enlarged={enlarged === screenKey} deafened={deafened} />
              {isNeo && <NeoCorners />}
              <span style={{ ...s.videoLabel, ...mono, ...(isNeo ? { background: "rgba(10,10,10,0.85)", color: "var(--accent)", borderRadius: 0, border: "1px solid var(--accent)", letterSpacing: "0.05em" } : {}) }}>
                <Icon name="screen" size={12} style={{ marginRight: 4 }} />{isNeo ? `@${member?.username || "?"}_screen` : `${member?.username || "?"} (экран)`}
              </span>
              {freeMode && <div style={s.resizeCorner} onMouseDown={(e) => { e.stopPropagation(); startDrag(screenKey, e, "resize"); }} />}
            </div>
          );
        })}

        {remoteVideos.length === 0 && (
          <div style={s.waiting}>
            <span style={{ ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.05em" } : {}) }}>
              {isNeo ? "> ожидание_участников..." : "Ожидание участников..."}
            </span>
          </div>
        )}
      </div>

      {/* Screen source picker */}
      {screenSources && (
        <div style={{ ...s.sourcePicker, ...(isNeo ? { borderRadius: 0, border: "1.5px solid var(--accent)", background: "#0a0a0a" } : {}) }}>
          <div style={{ ...s.sourceTitle, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase" } : {}) }}>
            {isNeo ? "// ВЫБЕРИ_ЭКРАН" : "Выберите экран для демонстрации"}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px", cursor: "pointer", color: isNeo ? "var(--accent)" : "var(--text-primary)", fontSize: 13, ...mono }}>
            <input
              type="checkbox"
              checked={screenShareAudio}
              onChange={(e) => setScreenShareAudio(e.target.checked)}
              style={{ accentColor: "var(--accent)" }}
            />
            {isNeo ? "// захватить_звук_системы" : "Захватить звук системы"}
            <span style={{ fontSize: 11, opacity: 0.6, marginLeft: "auto" }}>{isNeo ? "(Windows)" : "(только Windows)"}</span>
          </label>
          <div style={s.sourceGrid}>
            {screenSources.map((src: any) => (
              <div key={src.id} style={{ ...s.sourceItem, ...(isNeo ? { borderRadius: 0, border: "1px solid var(--border)", background: "transparent" } : {}) }} onClick={() => startScreenShare(src.id, screenShareAudio)}>
                <img src={src.thumbnail} style={{ ...s.sourceThumbnail, ...(isNeo ? { borderRadius: 0 } : {}) }} alt={src.name} />
                <span style={{ ...s.sourceName, ...mono }}>{src.name}</span>
              </div>
            ))}
          </div>
          <button
            style={{ ...s.sourceCancel, ...(isNeo ? { borderRadius: 0, background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" } : {}) }}
            onClick={() => setScreenSources(null)}
          >
            {isNeo ? "[ОТМЕНА]" : "Отмена"}
          </button>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div style={{ ...s.settingsPanel, ...(isNeo ? { borderRadius: 0, border: "1.5px solid var(--accent)", background: "#0a0a0a" } : {}) }}>
          <div style={s.settingRow}>
            <label style={{ ...s.settingLabel, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.05em" } : {}) }}>{isNeo ? "// МИКРОФОН" : "Микрофон"}</label>
            <select value={micDeviceId} style={{ ...s.settingSelect, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }} onChange={async (e) => {
              const id = e.target.value;
              setMicError(null);
              try {
                // Новая дорожка уходит во все peer'ы, gain-контекст пересобирается,
                // мьют переносится; при неудаче остаёмся на прежнем микрофоне
                // (select — контролируемый, откатится сам).
                await webrtcService.switchMicrophone(id, { muted, gain: micGain });
                setMicDeviceId(id);
                setMicEpoch((n) => n + 1);
              } catch (err) {
                console.error("[mic] change failed", err);
                setMicError("Микрофон не отвечает — оставил прежний");
              }
            }}>
              <option value="">{defaultMicLabel ? `По умолчанию (${defaultMicLabel})` : "По умолчанию"}</option>
              {audioDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Микрофон"}</option>)}
            </select>
            {micError && <div style={{ ...mono, color: "#ed4245", fontSize: 12, marginTop: 4 }}>{micError}</div>}
          </div>
          <div style={s.settingRow}>
            <label style={{ ...s.settingLabel, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.05em" } : {}) }}>{isNeo ? "// КАМЕРА" : "Камера"}</label>
            <select style={{ ...s.settingSelect, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }} onChange={async (e) => {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: e.target.value } }, audio: false });
                const newTrack = stream.getVideoTracks()[0];
                const ls = webrtcService.getLocalStream();
                if (ls) {
                  const oldTrack = ls.getVideoTracks()[0];
                  if (oldTrack) { ls.removeTrack(oldTrack); oldTrack.stop(); }
                  ls.addTrack(newTrack);
                  if (localVideoRef.current) localVideoRef.current.srcObject = ls;
                }
                // Push to every webcam peer (screen-share peers are independent)
                webrtcService.replaceVideoTrack(newTrack);
              } catch (err) { console.error("[cam] change failed", err); }
            }}>
              {videoDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Камера"}</option>)}
            </select>
          </div>
          {outputDevices.length > 0 && (
            <div style={s.settingRow}>
              <label style={{ ...s.settingLabel, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.05em" } : {}) }}>{isNeo ? "// ДИНАМИК" : "Динамик"}</label>
              <select
                value={outputDeviceId}
                style={{ ...s.settingSelect, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }}
                onChange={(e) => {
                  setOutputDeviceId(e.target.value);
                  // Apply to every existing media element. New ones added later will
                  // pick it up via the effect below.
                  document.querySelectorAll("video, audio").forEach((el: any) => {
                    if (el.setSinkId) el.setSinkId(e.target.value).catch(() => {});
                  });
                }}
              >
                <option value="">(по умолчанию)</option>
                {outputDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Динамик"}</option>)}
              </select>
            </div>
          )}
          <div style={s.settingRow}>
            <label style={{ ...s.settingLabel, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.05em" } : {}) }}>
              {isNeo ? `// ГРОМКОСТЬ_МИКРОФОНА: ${micGain}%` : `Громкость микрофона: ${micGain}%`}
            </label>
            <input type="range" min="0" max="200" value={micGain} style={{ width: "100%" }}
              onChange={(e) => {
                const val = Number(e.target.value);
                setMicGain(val);
                webrtcService.setMicGain(val);
              }}
            />
          </div>
        </div>
      )}

      <div style={s.controls}>
        {/* Mic */}
        <button
          style={{ ...s.ctrl, background: muted ? "#ed4245" : (isNeo ? "transparent" : "#3ba55d"), ...(isNeo ? neoCtrl(muted ? "#ed4245" : undefined) : {}) }}
          onClick={toggleMute}
          title={muted ? "Включить микрофон" : "Выключить микрофон"}
        >
          <Icon name={muted ? "mic-off" : "mic"} size={20} strokeWidth={2} style={{ color: isNeo && !muted ? "var(--accent)" : "#fff" }} />
        </button>

        {/* Video */}
        <button
          style={{ ...s.ctrl, background: videoOff ? "#ed4245" : (isNeo ? "transparent" : "#3ba55d"), ...(isNeo ? neoCtrl(videoOff ? "#ed4245" : undefined) : {}) }}
          onClick={toggleVideo}
          title={videoOff ? "Включить камеру" : "Выключить камеру"}
        >
          <Icon name={videoOff ? "cam-off" : "cam"} size={20} strokeWidth={2} style={{ color: isNeo && !videoOff ? "var(--accent)" : "#fff" }} />
        </button>

        {/* Screen share */}
        <button
          style={{ ...s.ctrl, background: screenSharing ? (isNeo ? "var(--accent)" : "#5865f2") : (isNeo ? "transparent" : "var(--bg-active)"), ...(isNeo ? neoCtrl(screenSharing ? "var(--accent)" : undefined) : {}) }}
          onClick={toggleScreenShare}
          title="Демонстрация экрана"
        >
          <Icon name="screen" size={20} strokeWidth={2} style={{ color: isNeo ? (screenSharing ? "#0a0a0a" : "var(--accent)") : "#fff" }} />
        </button>

        {/* Deafen */}
        <button
          style={{ ...s.ctrl, background: deafened ? "#ed4245" : (isNeo ? "transparent" : "var(--bg-active)"), ...(isNeo ? neoCtrl(deafened ? "#ed4245" : undefined) : {}) }}
          onClick={toggleDeafen}
          title={deafened ? "Включить звук" : "Заглушить всех"}
        >
          <Icon name={deafened ? "headphones-off" : "headphones"} size={20} strokeWidth={2} style={{ color: isNeo && !deafened ? "var(--accent)" : "#fff" }} />
        </button>

        {/* Free mode (universe icon) */}
        <button
          style={{ ...s.ctrl, background: freeMode ? (isNeo ? "var(--accent)" : "#5865f2") : (isNeo ? "transparent" : "var(--bg-active)"), ...(isNeo ? neoCtrl(freeMode ? "var(--accent)" : undefined) : {}) }}
          onClick={() => { setFreeMode(!freeMode); setTilePositions(new Map()); }}
          title="Свободный режим"
        >
          <Icon name="globe" size={20} strokeWidth={2} style={{ color: isNeo ? (freeMode ? "#0a0a0a" : "var(--accent)") : "#fff" }} />
        </button>

        {/* Settings */}
        <button
          style={{ ...s.ctrl, background: showSettings ? (isNeo ? "var(--accent)" : "#5865f2") : (isNeo ? "transparent" : "var(--bg-active)"), ...(isNeo ? neoCtrl(showSettings ? "var(--accent)" : undefined) : {}) }}
          onClick={() => setShowSettings(!showSettings)}
          title="Настройки"
        >
          <Icon name="gear" size={20} strokeWidth={2} style={{ color: isNeo ? (showSettings ? "#0a0a0a" : "var(--accent)") : "#fff" }} />
        </button>

        {/* Hangup */}
        <button
          style={{ ...s.ctrl, ...s.hangup, ...(isNeo ? { borderRadius: 0, width: 80, height: 44, letterSpacing: "0.1em", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#fff", border: "1.5px solid #ed4245" } : {}) }}
          onClick={handleEnd}
          title="Завершить звонок"
        >
          {isNeo ? (
            <span>[END]</span>
          ) : (
            <Icon name="end" size={24} strokeWidth={2} style={{ color: "#fff" }} />
          )}
        </button>
      </div>
    </div>
  );
}

function RemoteVideo({ entry, chat, enlarged, deafened, peerMuted, peerVideoOff, peerScreenSharing, volume, onVolumeChange, onClick, freeMode, freePos, onStartDrag, isNeo }: {
  entry: VideoEntry; chat: ChatOut; enlarged: boolean; deafened: boolean; peerMuted: boolean;
  peerVideoOff?: boolean; peerScreenSharing?: boolean;
  volume: number; onVolumeChange: (v: number) => void; onClick: () => void;
  freeMode?: boolean; freePos?: { x: number; y: number; w: number; h: number } | null;
  onStartDrag?: (e: React.MouseEvent, mode: "move" | "resize") => void;
  isNeo?: boolean;
}) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const ref = useRef<HTMLVideoElement>(null);
  const member = chat.members.find((m) => m.id === entry.userId);
  const [showVolume, setShowVolume] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = entry.stream;
      ref.current.volume = deafened ? 0 : Math.min(volume / 100, 1);
    }
  }, [entry.stream, volume, deafened]);


  // Voice activity detection
  useEffect(() => {
    const audioTracks = entry.stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    const ac = new AudioContext();
    const source = ac.createMediaStreamSource(entry.stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const interval = setInterval(() => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setSpeaking(avg > 15);
    }, 100);

    return () => {
      clearInterval(interval);
      ac.close();
    };
  }, [entry.stream]);

  return (
    <div
      data-tile-id={`remote-${entry.userId}`}
      style={{
        ...s.videoWrap,
        ...(!freeMode && enlarged ? s.enlarged : {}),
        ...(freeMode && freePos ? { position: "absolute" as const, left: freePos.x, top: freePos.y, width: freePos.w, height: freePos.h } : {}),
        cursor: freeMode ? "move" : "pointer",
        boxShadow: speaking ? (isNeo ? "0 0 0 2px var(--accent), 0 0 12px rgba(198,255,61,0.5)" : "0 0 0 3px #57f287") : "none",
        transition: freeMode ? "none" : "box-shadow 0.15s",
        willChange: freeMode ? "left, top, width, height" : "auto",
        ...(isNeo ? { borderRadius: 0, border: "1px solid var(--border)" } : {}),
      }}
      onMouseDown={(e) => freeMode && onStartDrag?.(e, "move")}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); setShowVolume(!showVolume); }}
    >
      <video ref={ref} autoPlay playsInline style={{
        ...(freeMode ? { width: "100%", height: "100%", objectFit: (peerScreenSharing ? "contain" : "cover") as const, display: "block" } : (enlarged ? s.videoEnlarged : s.video)),
        // Don't use display:none when peer turns video off — Chromium stops
        // decoding the whole element, audio included, and the call goes silent
        // until the next visibility flip. The avatar overlay below already
        // covers the (empty) video frame visually.
        display: "block",
      }} />
      {isNeo && <NeoCorners />}
      {freeMode && <div style={s.resizeCorner} onMouseDown={(e) => { e.stopPropagation(); onStartDrag?.(e, "resize"); }} />}
      {(peerVideoOff && !peerScreenSharing || entry.stream.getVideoTracks().length === 0) && member && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isNeo ? "#0a0a0a" : "#18191c" }}>
          <CallAvatar name={member.username} url={member.avatar_url} isNeo={isNeo} />
        </div>
      )}
      <button
        style={{ ...s.pipBtn, ...(isNeo ? { borderRadius: 0, border: "1px solid var(--accent)", background: "rgba(10,10,10,0.85)", color: "var(--accent)" } : {}) }}
        onClick={(e) => {
          e.stopPropagation();
          if (ref.current && (ref.current as any).requestPictureInPicture) {
            (ref.current as any).requestPictureInPicture().catch(() => {});
          }
        }}
        title="В отдельное окно"
      >⧉</button>
      <span style={{ ...s.videoLabel, ...mono, ...(isNeo ? { background: "rgba(10,10,10,0.85)", color: "var(--accent)", borderRadius: 0, border: "1px solid var(--accent)", letterSpacing: "0.05em" } : {}) }}>
        {peerMuted && <Icon name="mic-off" size={12} style={{ marginRight: 4 }} />}
        {peerScreenSharing && <Icon name="screen" size={12} style={{ marginRight: 4 }} />}
        {isNeo ? "@" : ""}{member?.username || "Участник"}
        {peerScreenSharing ? (isNeo ? "_screen" : " (экран)") : ""}
      </span>
      {showVolume && (
        <div style={s.volumeSlider} onClick={(e) => e.stopPropagation()}>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            style={{ width: "100%" }}
          />
          <span style={{ color: "#fff", fontSize: 11 }}>{volume}%</span>
        </div>
      )}
    </div>
  );
}

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function CallAvatar({ name, url, isNeo }: { name: string; url: string | null; isNeo?: boolean }) {
  const colors = ["#5865f2", "#57f287", "#fee75c", "#ed4245", "#eb459e", "#faa61a", "#00b0f4"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const bg = isNeo ? "#0a0a0a" : colors[Math.abs(hash) % colors.length];
  const radius = isNeo ? 0 : "50%";
  const border = isNeo ? "2px solid var(--accent)" : "none";
  const fg = isNeo ? "var(--accent)" : "#fff";
  return url ? (
    <img src={url.startsWith("http") ? url : `${BASE_URL}${url}`}
      style={{ width: 80, height: 80, borderRadius: radius, border, objectFit: "cover", margin: "65px auto", display: "block" }} alt={name} />
  ) : (
    <div style={{ width: 80, height: 80, borderRadius: radius, border, background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: fg, fontWeight: 700, fontSize: 32, margin: "65px auto", fontFamily: isNeo ? "var(--font-mono)" : undefined }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function NeoCorners() {
  const size = 14;
  const thick = 2;
  const color = "var(--accent)";
  const base: React.CSSProperties = { position: "absolute", width: size, height: size, pointerEvents: "none" };
  return (
    <>
      <span style={{ ...base, top: 6, left: 6, borderTop: `${thick}px solid ${color}`, borderLeft: `${thick}px solid ${color}` }} />
      <span style={{ ...base, top: 6, right: 6, borderTop: `${thick}px solid ${color}`, borderRight: `${thick}px solid ${color}` }} />
      <span style={{ ...base, bottom: 6, left: 6, borderBottom: `${thick}px solid ${color}`, borderLeft: `${thick}px solid ${color}` }} />
      <span style={{ ...base, bottom: 6, right: 6, borderBottom: `${thick}px solid ${color}`, borderRight: `${thick}px solid ${color}` }} />
    </>
  );
}

function RemoteScreenVideo({ stream, freeMode, enlarged, deafened }: { stream: MediaStream; freeMode: boolean; enlarged: boolean; deafened?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const hasAudio = stream.getAudioTracks().length > 0;
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    // Mute only when there's no audio to play (or user has deafened everyone).
    ref.current.muted = !hasAudio || !!deafened;
    ref.current.play().catch(() => {});
  }, [stream, hasAudio, deafened]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={!hasAudio || !!deafened}
      style={freeMode
        ? { width: "100%", height: "100%", objectFit: "contain" as const, display: "block", pointerEvents: "none" as const }
        : (enlarged ? { width: "100%", height: "auto", maxHeight: "60vh", objectFit: "contain" as const, display: "block" } : { width: 280, height: 210, objectFit: "contain" as const, display: "block" })}
    />
  );
}

function HiddenAudio({ stream, deafened, volume }: { stream: MediaStream; deafened: boolean; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.volume = deafened ? 0 : Math.min(volume / 100, 1);
    }
  }, [stream, volume, deafened]);
  return <audio ref={ref} autoPlay style={{ display: "none" }} />;
}

const s: Record<string, React.CSSProperties> = {
  miniBar: {
    position: "fixed", bottom: 60, right: 16, zIndex: 100,
    background: "#3ba55d", display: "flex", alignItems: "center",
    gap: 12, padding: "8px 14px",
    cursor: "pointer", borderRadius: 8,
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  },
  miniText: { color: "#fff", fontWeight: 600, fontSize: 13 },
  miniBtn: {
    background: "rgba(0,0,0,0.3)", color: "#fff", border: "none",
    borderRadius: 4, padding: "4px 10px", fontSize: 14, cursor: "pointer",
  },
  overlay: {
    position: "absolute", inset: 0, zIndex: 100,
    background: "rgba(0,0,0,0.95)",
    display: "flex", flexDirection: "column",
    alignItems: "center",
    userSelect: "none" as const,
  },
  header: { padding: "16px 0 8px", textAlign: "center", position: "relative" as const, width: "100%" },
  title: { color: "#fff", fontWeight: 700, fontSize: 18, display: "block" },
  subtitle: { color: "var(--text-muted)", fontSize: 14 },
  minimizeBtn: {
    position: "absolute" as const, right: 16, top: 16,
    background: "rgba(255,255,255,0.1)", color: "#fff", border: "none",
    borderRadius: 4, padding: "4px 12px", fontSize: 14, cursor: "pointer",
  },
  videoGrid: {
    flex: 1, width: "100%", display: "flex", flexWrap: "wrap",
    alignItems: "center", justifyContent: "center", gap: 12, padding: 16,
  },
  videoGridFree: {
    flex: 1, width: "100%", position: "relative" as const, overflow: "hidden",
  },
  videoWrap: {
    position: "relative", borderRadius: 8, overflow: "hidden",
    background: "#18191c", transition: "all 0.3s",
    width: 280, height: 210, minWidth: 280, minHeight: 210,
  },
  // height: auto ОБЯЗАТЕЛЕН: базовый videoWrap фиксирует height/minHeight 210,
  // без переопределения фокусная плитка росла только в ширину, а картинка
  // резалась по вертикали (overflow: hidden).
  enlarged: { width: "50%", maxWidth: "50%", height: "auto", minHeight: 210 },
  video: { width: 280, height: 210, objectFit: "cover", display: "block" },
  videoEnlarged: { width: "100%", height: "auto", maxHeight: "60vh", objectFit: "contain" as const, display: "block" },
  videoLabel: {
    position: "absolute", bottom: 8, left: 8,
    background: "rgba(0,0,0,0.6)", color: "#fff",
    padding: "2px 8px", borderRadius: 4, fontSize: 12,
  },
  pipBtn: {
    position: "absolute" as const, top: 8, right: 8,
    background: "rgba(0,0,0,0.6)", color: "#fff", border: "none",
    width: 28, height: 28, borderRadius: 4, cursor: "pointer", fontSize: 14,
  },
  resizeCorner: {
    position: "absolute" as const, right: 0, bottom: 0, width: 16, height: 16,
    cursor: "nwse-resize", background: "rgba(255,255,255,0.4)",
    clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
  },
  volumeSlider: {
    position: "absolute", bottom: 32, left: 8, right: 8,
    background: "rgba(0,0,0,0.8)", borderRadius: 4, padding: "4px 8px",
    display: "flex", flexDirection: "column", gap: 2,
  },
  waiting: { color: "var(--text-muted)", fontSize: 16 },
  controls: { display: "flex", gap: 12, padding: "16px 0 24px" },
  ctrl: {
    width: 52, height: 52, borderRadius: "50%",
    fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", cursor: "pointer", transition: "opacity 0.15s",
  },
  hangup: {
    background: "#ed4245", width: 60, height: 52, borderRadius: 26,
  },
  sourcePicker: {
    background: "rgba(30,31,34,0.98)", borderRadius: 12, padding: 20,
    width: 500, maxWidth: "90%", maxHeight: "70%", overflowY: "auto" as const,
  },
  sourceTitle: { color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 16, textAlign: "center" as const },
  sourceGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 },
  sourceItem: {
    background: "var(--bg-tertiary)", borderRadius: 8, padding: 8, cursor: "pointer",
    border: "2px solid transparent", transition: "border-color 0.15s",
  },
  sourceThumbnail: { width: "100%", borderRadius: 4, display: "block", marginBottom: 6 },
  sourceName: { color: "var(--text-primary)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, display: "block" },
  sourceCancel: { marginTop: 12, width: "100%", background: "var(--bg-active)", color: "#fff", border: "none", borderRadius: 6, padding: "8px", fontSize: 13, cursor: "pointer" },
  settingsPanel: {
    background: "rgba(30,31,34,0.95)", borderRadius: 8, padding: 16,
    width: 320, maxWidth: "90%",
  },
  settingRow: { marginBottom: 12 },
  settingLabel: { color: "var(--text-muted)", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 },
  settingSelect: {
    width: "100%", background: "var(--bg-tertiary)", color: "var(--text-primary)",
    border: "1px solid var(--border)", borderRadius: 4, padding: "6px 8px", fontSize: 13,
  },
};
