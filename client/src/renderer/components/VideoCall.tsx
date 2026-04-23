import React, { useEffect, useRef, useState } from "react";
import { ChatOut, UserOut } from "../services/api";
import { webrtcService } from "../services/webrtc";
import { wsService } from "../services/ws";
import { playCallRing, playCallEndSound } from "../services/sounds";
import { useTheme } from "../services/theme";

interface Props {
  chat: ChatOut;
  currentUser: UserOut;
  initiator: boolean;
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

export default function VideoCall({ chat, currentUser, initiator, onEnd }: Props) {
  const theme = useTheme();
  const isNeo = theme === "neo";
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [remoteVideos, setRemoteVideos] = useState<VideoEntry[]>([]);
  const [remoteScreens, setRemoteScreens] = useState<VideoEntry[]>([]);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
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
  }, [remoteVideos.length]); // re-run when call connects

  // Load available devices
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
      setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
      setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
    });
  }, []);

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
        localStream = await webrtcService.startCall(chat.id, memberIds, true);
      } else {
        const initiatorId = memberIds.find((id) => id !== currentUser.id)!;
        localStream = await webrtcService.joinCall(chat.id, initiatorId, true);
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
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

  function toggleVideo() {
    const newVideoOff = !videoOff;
    const stream = webrtcService.getLocalStream();
    stream?.getVideoTracks().forEach((t) => (t.enabled = !newVideoOff));
    setVideoOff(newVideoOff);
    wsService.send({ type: "video_status", chat_id: chat.id, video_off: newVideoOff });
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
    const startX = e.clientX;
    const startY = e.clientY;
    const pos = tilePositions.get(id) || { x: 20, y: 20, w: 280, h: 210 };
    const tileEl = (e.currentTarget as HTMLElement).closest("[data-tile-id]") as HTMLElement | null;
    if (!tileEl) return;
    let lastFrame: number | null = null;
    let pendingPos = { ...pos };

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (mode === "move") {
        pendingPos = { ...pos, x: pos.x + dx, y: pos.y + dy };
      } else {
        pendingPos = { ...pos, w: Math.max(160, pos.w + dx), h: Math.max(120, pos.h + dy) };
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
      // Commit final position to state
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
              <>📞 {callName} — {remoteVideos.length + 1}</>
            )}
          </span>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              style={{ ...s.miniBtn, ...(isNeo ? { borderRadius: 0, border: "1px solid var(--border)", background: "transparent" } : {}) }}
              onClick={(e) => { e.stopPropagation(); toggleMute(); }}
              title={muted ? "Включить микрофон" : "Заглушить"}
            >
              <MicIcon muted={muted} color={isNeo ? "var(--accent)" : "#fff"} />
            </button>
            <button
              style={{ ...s.miniBtn, background: "transparent", border: "1px solid rgba(255,255,255,0.4)", ...(isNeo ? { borderRadius: 0, borderColor: "var(--accent)" } : {}) }}
              onClick={(e) => { e.stopPropagation(); setMinimized(false); }}
              title="Развернуть"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isNeo ? "var(--accent)" : "white"} strokeWidth="2.5" strokeLinecap="round"><polyline points="4 10 10 4 10 10" /><polyline points="20 14 14 20 14 14" /></svg>
            </button>
            <button
              style={{ ...s.miniBtn, background: "#ed4245", ...(isNeo ? { borderRadius: 0 } : {}) }}
              onClick={(e) => { e.stopPropagation(); handleEnd(); }}
              title="Завершить"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M12 9c-1.66 0-3 1.34-3 3v2H5c-1.1 0-2-.9-2-2v-1c0-3.87 3.13-7 7-7h4c3.87 0 7 3.13 7 7v1c0 1.1-.9 2-2 2h-4v-2c0-1.66-1.34-3-3-3z" transform="rotate(135 12 12)"/>
              </svg>
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
        <button
          style={{ ...s.minimizeBtn, ...(isNeo ? { borderRadius: 0, border: "1px solid var(--border)", background: "transparent", color: "var(--accent)" } : {}) }}
          onClick={() => setMinimized(true)}
          title="Свернуть"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isNeo ? "var(--accent)" : "white"} strokeWidth="2.5" strokeLinecap="round"><polyline points="4 14 10 20 16 14"/><line x1="10" y1="20" x2="10" y2="4"/></svg>
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
              }}
              onMouseDown={(e) => freeMode && startDrag(screenKey, e, "move")}
              onClick={() => !freeMode && setEnlarged(enlarged === screenKey ? null : screenKey)}
            >
              <RemoteScreenVideo stream={entry.stream} freeMode={!!freeMode} enlarged={enlarged === screenKey} deafened={deafened} />
              {isNeo && <NeoCorners />}
              <span style={{ ...s.videoLabel, ...mono, ...(isNeo ? { background: "rgba(10,10,10,0.85)", color: "var(--accent)", borderRadius: 0, border: "1px solid var(--accent)", letterSpacing: "0.05em" } : {}) }}>
                📺 {isNeo ? `@${member?.username || "?"}_screen` : `${member?.username || "?"} (экран)`}
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
            <select style={{ ...s.settingSelect, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }} onChange={async (e) => {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: e.target.value }, video: false });
                const newTrack = stream.getAudioTracks()[0];
                const ls = webrtcService.getLocalStream();
                if (ls) {
                  const oldTrack = ls.getAudioTracks()[0];
                  ls.removeTrack(oldTrack);
                  oldTrack.stop();
                  ls.addTrack(newTrack);
                }
                // Reset gain context to use new audio source
                webrtcService.resetGainContext();
                if (micGain !== 100) webrtcService.setMicGain(micGain);
              } catch {}
            }}>
              {audioDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Микрофон"}</option>)}
            </select>
          </div>
          <div style={s.settingRow}>
            <label style={{ ...s.settingLabel, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.05em" } : {}) }}>{isNeo ? "// КАМЕРА" : "Камера"}</label>
            <select style={{ ...s.settingSelect, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }} onChange={async (e) => {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: e.target.value }, audio: false });
                const newTrack = stream.getVideoTracks()[0];
                const ls = webrtcService.getLocalStream();
                if (ls && localVideoRef.current) {
                  const oldTrack = ls.getVideoTracks()[0];
                  if (oldTrack) { ls.removeTrack(oldTrack); oldTrack.stop(); }
                  ls.addTrack(newTrack);
                  localVideoRef.current.srcObject = ls;
                }
              } catch {}
            }}>
              {videoDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Камера"}</option>)}
            </select>
          </div>
          {outputDevices.length > 0 && (
            <div style={s.settingRow}>
              <label style={{ ...s.settingLabel, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.05em" } : {}) }}>{isNeo ? "// ДИНАМИК" : "Динамик"}</label>
              <select style={{ ...s.settingSelect, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }} onChange={(e) => {
                document.querySelectorAll("video, audio").forEach((el: any) => {
                  if (el.setSinkId) el.setSinkId(e.target.value);
                });
              }}>
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isNeo && !muted ? "var(--accent)" : "white"} strokeWidth="2" strokeLinecap="round">
            {muted ? (
              <><rect x="9" y="1" width="6" height="13" rx="3" fill="white"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M17 11a5 5 0 01-8.2 3.8"/><path d="M12 19v4M8 23h8"/></>
            ) : (
              <><rect x="9" y="1" width="6" height="13" rx="3" fill={isNeo ? "var(--accent)" : "white"}/><path d="M5 11a7 7 0 0014 0"/><path d="M12 19v4M8 23h8"/></>
            )}
          </svg>
        </button>

        {/* Video */}
        <button
          style={{ ...s.ctrl, background: videoOff ? "#ed4245" : (isNeo ? "transparent" : "#3ba55d"), ...(isNeo ? neoCtrl(videoOff ? "#ed4245" : undefined) : {}) }}
          onClick={toggleVideo}
          title={videoOff ? "Включить камеру" : "Выключить камеру"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isNeo && !videoOff ? "var(--accent)" : "white"} strokeWidth="2" strokeLinecap="round">
            {videoOff ? (
              <><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 7l-5 3.5L21 14V7z"/><rect x="2" y="5" width="14" height="14" rx="2" fill="white" opacity="0.3"/></>
            ) : (
              <><rect x="2" y="5" width="14" height="14" rx="2" fill={isNeo ? "var(--accent)" : "white"}/><path d="M23 7l-7 5 7 5V7z" fill={isNeo ? "var(--accent)" : "white"}/></>
            )}
          </svg>
        </button>

        {/* Screen share */}
        <button
          style={{ ...s.ctrl, background: screenSharing ? (isNeo ? "var(--accent)" : "#5865f2") : (isNeo ? "transparent" : "var(--bg-active)"), ...(isNeo ? neoCtrl(screenSharing ? "var(--accent)" : undefined) : {}) }}
          onClick={toggleScreenShare}
          title="Демонстрация экрана"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isNeo ? (screenSharing ? "#0a0a0a" : "var(--accent)") : "white"} strokeWidth="2" strokeLinecap="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </button>

        {/* Deafen */}
        <button
          style={{ ...s.ctrl, background: deafened ? "#ed4245" : (isNeo ? "transparent" : "var(--bg-active)"), ...(isNeo ? neoCtrl(deafened ? "#ed4245" : undefined) : {}) }}
          onClick={toggleDeafen}
          title={deafened ? "Включить звук" : "Заглушить всех"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isNeo && !deafened ? "var(--accent)" : "white"} strokeWidth="2" strokeLinecap="round">
            {deafened ? (
              <><path d="M3 14h2a2 2 0 012 2v2a2 2 0 01-2 2H3V14z"/><path d="M21 14h-2a2 2 0 00-2 2v2a2 2 0 002 2h2V14z"/><path d="M3 14V9a9 9 0 0118 0v5"/><line x1="1" y1="1" x2="23" y2="23"/></>
            ) : (
              <><path d="M3 14h2a2 2 0 012 2v2a2 2 0 01-2 2H3V14z" fill={isNeo ? "var(--accent)" : "white"}/><path d="M21 14h-2a2 2 0 00-2 2v2a2 2 0 002 2h2V14z" fill={isNeo ? "var(--accent)" : "white"}/><path d="M3 14V9a9 9 0 0118 0v5"/></>
            )}
          </svg>
        </button>

        {/* Free mode (universe icon) */}
        <button
          style={{ ...s.ctrl, background: freeMode ? (isNeo ? "var(--accent)" : "#5865f2") : (isNeo ? "transparent" : "var(--bg-active)"), ...(isNeo ? neoCtrl(freeMode ? "var(--accent)" : undefined) : {}) }}
          onClick={() => { setFreeMode(!freeMode); setTilePositions(new Map()); }}
          title="Свободный режим"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isNeo ? (freeMode ? "#0a0a0a" : "var(--accent)") : "white"} strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="10" ry="4"/><path d="M2 12h20"/>
          </svg>
        </button>

        {/* Settings */}
        <button
          style={{ ...s.ctrl, background: showSettings ? (isNeo ? "var(--accent)" : "#5865f2") : (isNeo ? "transparent" : "var(--bg-active)"), ...(isNeo ? neoCtrl(showSettings ? "var(--accent)" : undefined) : {}) }}
          onClick={() => setShowSettings(!showSettings)}
          title="Настройки"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isNeo ? (showSettings ? "#0a0a0a" : "var(--accent)") : "white"} strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
              <path d="M12 9c-1.66 0-3 1.34-3 3v2H5c-1.1 0-2-.9-2-2v-1c0-3.87 3.13-7 7-7h4c3.87 0 7 3.13 7 7v1c0 1.1-.9 2-2 2h-4v-2c0-1.66-1.34-3-3-3z" transform="rotate(135 12 12)"/>
            </svg>
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
        display: peerVideoOff && !peerScreenSharing ? "none" : "block",
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
        {peerMuted ? "🔇 " : ""}
        {peerScreenSharing ? "📺 " : ""}
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

function MicIcon({ muted, color }: { muted: boolean; color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Mic body with inner grill detail */}
      <rect x="9" y="2" width="6" height="12" rx="3" fill={color} opacity="0.92"/>
      <line x1="10.5" y1="5" x2="13.5" y2="5" stroke={muted ? color : "rgba(0,0,0,0.35)"} strokeWidth="0.8" opacity="0.55"/>
      <line x1="10.5" y1="8" x2="13.5" y2="8" stroke={muted ? color : "rgba(0,0,0,0.35)"} strokeWidth="0.8" opacity="0.55"/>
      <line x1="10.5" y1="11" x2="13.5" y2="11" stroke={muted ? color : "rgba(0,0,0,0.35)"} strokeWidth="0.8" opacity="0.55"/>
      {/* Arc catcher */}
      <path d="M5 11a7 7 0 0014 0"/>
      {/* Stand */}
      <line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="8" y1="22" x2="16" y2="22"/>
      {/* Muted slash */}
      {muted && <line x1="3" y1="3" x2="21" y2="21" stroke={color} strokeWidth="2.2"/>}
    </svg>
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
  enlarged: { width: "50%", maxWidth: "50%" },
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
