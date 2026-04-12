import React, { useEffect, useRef, useState } from "react";
import { ChatOut, UserOut } from "../services/api";
import { webrtcService } from "../services/webrtc";
import { wsService } from "../services/ws";
import { playCallRing, playCallEndSound } from "../services/sounds";

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

export default function VideoCall({ chat, currentUser, initiator, onEnd }: Props) {
  const [remoteVideos, setRemoteVideos] = useState<VideoEntry[]>([]);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [screenSources, setScreenSources] = useState<any[] | null>(null);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const [minimized, setMinimized] = useState(false);
  const [callStartTime] = useState(Date.now());
  const [callDuration, setCallDuration] = useState("00:00");
  const [freeMode, setFreeMode] = useState(false);
  const [tilePositions, setTilePositions] = useState<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const [peerVolumes, setPeerVolumes] = useState<Map<number, number>>(new Map());
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [mutedPeers, setMutedPeers] = useState<Set<number>>(new Set());
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

  // Listen for mute status from other users
  useEffect(() => {
    const handler = (data: any) => {
      setMutedPeers((prev) => {
        const next = new Set(prev);
        data.muted ? next.add(data.user_id) : next.delete(data.user_id);
        return next;
      });
    };
    wsService.on("mute_status", handler);
    return () => wsService.off("mute_status", handler);
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

    webrtcService.onPeerLeft = (userId) => {
      setRemoteVideos((prev) => prev.filter((v) => v.userId !== userId));
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
    const stream = webrtcService.getLocalStream();
    stream?.getAudioTracks().forEach((t) => (t.enabled = muted));
    const newMuted = !muted;
    setMuted(newMuted);
    wsService.send({ type: "mute_status", chat_id: chat.id, muted: newMuted });
  }

  function toggleVideo() {
    const stream = webrtcService.getLocalStream();
    stream?.getVideoTracks().forEach((t) => (t.enabled = videoOff));
    setVideoOff(!videoOff);
  }

  function toggleDeafen() {
    const newDeaf = !deafened;
    setDeafened(newDeaf);
    // Mute/unmute all remote audio
    remoteVideos.forEach((entry) => {
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

  async function startScreenShare(sourceId: string) {
    setScreenSources(null);
    try {
      const stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId,
          },
        },
      });
      const screenTrack = stream.getVideoTracks()[0];
      // Send screen to peers but keep local webcam running
      webrtcService.replaceVideoTrack(screenTrack);
      setScreenStream(stream);
      setScreenSharing(true);
      // Don't change localVideoRef — keep showing webcam
      screenTrack.onended = () => stopScreenShare();
    } catch {}
  }

  function stopScreenShare() {
    screenStream?.getTracks().forEach((t) => t.stop());
    setScreenStream(null);
    setScreenSharing(false);
    // Restore webcam track to peers
    const ls = webrtcService.getLocalStream();
    const camTrack = ls?.getVideoTracks()[0];
    if (camTrack) {
      webrtcService.replaceVideoTrack(camTrack);
    }
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
    const startX = e.clientX;
    const startY = e.clientY;
    const pos = tilePositions.get(id) || { x: 20, y: 20, w: 280, h: 210 };
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setTilePositions((prev) => {
        const next = new Map(prev);
        if (mode === "move") {
          next.set(id, { ...pos, x: pos.x + dx, y: pos.y + dy });
        } else {
          next.set(id, { ...pos, w: Math.max(160, pos.w + dx), h: Math.max(120, pos.h + dy) });
        }
        return next;
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const callName = chat.is_group ? chat.name : chat.members.find((m) => m.id !== currentUser.id)?.username;

  if (minimized) {
    return (
      <>
        {/* Hidden audio elements to keep remote streams playing */}
        {remoteVideos.map((entry) => (
          <HiddenAudio key={entry.userId} stream={entry.stream} deafened={deafened} volume={peerVolumes.get(entry.userId) ?? 100} />
        ))}
        <div style={s.miniBar} onClick={() => setMinimized(false)}>
          <span style={s.miniText}>📞 {callName} — {remoteVideos.length + 1} участник(ов)</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.miniBtn} onClick={(e) => { e.stopPropagation(); toggleMute(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                {muted ? (
                  <><rect x="9" y="1" width="6" height="13" rx="3" fill="white"/><line x1="1" y1="1" x2="23" y2="23"/></>
                ) : (
                  <><rect x="9" y="1" width="6" height="13" rx="3" fill="white"/><path d="M5 11a7 7 0 0014 0"/></>
                )}
              </svg>
            </button>
            <button style={{ ...s.miniBtn, background: "#ed4245" }} onClick={(e) => { e.stopPropagation(); handleEnd(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M12 9c-1.66 0-3 1.34-3 3v2H5c-1.1 0-2-.9-2-2v-1c0-3.87 3.13-7 7-7h4c3.87 0 7 3.13 7 7v1c0 1.1-.9 2-2 2h-4v-2c0-1.66-1.34-3-3-3z" transform="rotate(135 12 12)"/>
              </svg>
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div style={s.overlay}>
      <div style={s.header}>
        <span style={s.title}>Видеозвонок • {callDuration}</span>
        <span style={s.subtitle}>{callName}</span>
        <button style={s.minimizeBtn} onClick={() => setMinimized(true)} title="Свернуть">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><polyline points="4 14 10 20 16 14"/><line x1="10" y1="20" x2="10" y2="4"/></svg>
        </button>
      </div>

      <div style={freeMode ? s.videoGridFree : s.videoGrid}>
        {/* Local video */}
        {(() => {
          const pos = freeMode ? getTilePos("self", 0) : null;
          return (
            <div
              style={{
                ...s.videoWrap,
                ...(!freeMode && enlarged === "self" ? s.enlarged : {}),
                ...(freeMode && pos ? { position: "absolute" as const, left: pos.x, top: pos.y, width: pos.w, height: pos.h } : {}),
                boxShadow: selfSpeaking && !muted ? "0 0 0 3px #57f287" : "none",
                transition: freeMode ? "none" : "box-shadow 0.15s",
                cursor: freeMode ? "move" : "pointer",
              }}
              onMouseDown={(e) => freeMode && startDrag("self", e, "move")}
              onClick={() => !freeMode && setEnlarged(enlarged === "self" ? null : "self")}
            >
              <video ref={localVideoRef} autoPlay muted playsInline style={{
                ...(freeMode ? { width: "100%", height: "100%", objectFit: "cover" as const } : (enlarged === "self" ? s.videoEnlarged : s.video)),
                display: videoOff ? "none" : "block",
              }} />
              {videoOff && <CallAvatar name={currentUser.username} url={currentUser.avatar_url} />}
              <span style={s.videoLabel}>Вы</span>
              {freeMode && <div style={s.resizeCorner} onMouseDown={(e) => startDrag("self", e, "resize")} />}
            </div>
          );
        })()}

        {/* Screen share tile */}
        {screenStream && (() => {
          const pos = freeMode ? getTilePos("screen", 1) : null;
          return (
            <div
              style={{
                ...s.videoWrap,
                ...(!freeMode && enlarged === "screen" ? s.enlarged : {}),
                ...(freeMode && pos ? { position: "absolute" as const, left: pos.x, top: pos.y, width: pos.w, height: pos.h } : {}),
                cursor: freeMode ? "move" : "pointer", border: "2px solid #5865f2",
              }}
              onMouseDown={(e) => freeMode && startDrag("screen", e, "move")}
              onClick={() => !freeMode && setEnlarged(enlarged === "screen" ? null : "screen")}
            >
              <video ref={screenVideoRef} autoPlay muted playsInline style={freeMode ? { width: "100%", height: "100%", objectFit: "contain" as const } : (enlarged === "screen" ? s.videoEnlarged : s.video)} />
              <span style={s.videoLabel}>Ваш экран</span>
              {freeMode && <div style={s.resizeCorner} onMouseDown={(e) => startDrag("screen", e, "resize")} />}
            </div>
          );
        })()}

        {/* Remote videos */}
        {remoteVideos.map((entry, idx) => (
          <RemoteVideo
            key={entry.userId}
            entry={entry}
            chat={chat}
            enlarged={enlarged === String(entry.userId)}
            deafened={deafened}
            peerMuted={mutedPeers.has(entry.userId)}
            volume={peerVolumes.get(entry.userId) ?? 100}
            onVolumeChange={(v) => changePeerVolume(entry.userId, v)}
            onClick={() => !freeMode && setEnlarged(enlarged === String(entry.userId) ? null : String(entry.userId))}
            freeMode={freeMode}
            freePos={freeMode ? getTilePos(`r${entry.userId}`, idx + 2) : null}
            onStartDrag={(e, mode) => startDrag(`r${entry.userId}`, e, mode)}
          />
        ))}

        {remoteVideos.length === 0 && (
          <div style={s.waiting}>
            <span>Ожидание участников...</span>
          </div>
        )}
      </div>

      {/* Screen source picker */}
      {screenSources && (
        <div style={s.sourcePicker}>
          <div style={s.sourceTitle}>Выберите экран для демонстрации</div>
          <div style={s.sourceGrid}>
            {screenSources.map((src: any) => (
              <div key={src.id} style={s.sourceItem} onClick={() => startScreenShare(src.id)}>
                <img src={src.thumbnail} style={s.sourceThumbnail} alt={src.name} />
                <span style={s.sourceName}>{src.name}</span>
              </div>
            ))}
          </div>
          <button style={s.sourceCancel} onClick={() => setScreenSources(null)}>Отмена</button>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div style={s.settingsPanel}>
          <div style={s.settingRow}>
            <label style={s.settingLabel}>Микрофон</label>
            <select style={s.settingSelect} onChange={async (e) => {
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
              } catch {}
            }}>
              {audioDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Микрофон"}</option>)}
            </select>
          </div>
          <div style={s.settingRow}>
            <label style={s.settingLabel}>Камера</label>
            <select style={s.settingSelect} onChange={async (e) => {
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
              <label style={s.settingLabel}>Динамик</label>
              <select style={s.settingSelect} onChange={(e) => {
                document.querySelectorAll("video, audio").forEach((el: any) => {
                  if (el.setSinkId) el.setSinkId(e.target.value);
                });
              }}>
                {outputDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Динамик"}</option>)}
              </select>
            </div>
          )}
          <div style={s.settingRow}>
            <label style={s.settingLabel}>Громкость микрофона: {micGain}%</label>
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
        <button style={{ ...s.ctrl, background: muted ? "#ed4245" : "#3ba55d" }} onClick={toggleMute} title={muted ? "Включить микрофон" : "Выключить микрофон"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            {muted ? (
              <><rect x="9" y="1" width="6" height="13" rx="3" fill="white"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M17 11a5 5 0 01-8.2 3.8"/><path d="M12 19v4M8 23h8"/></>
            ) : (
              <><rect x="9" y="1" width="6" height="13" rx="3" fill="white"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 19v4M8 23h8"/></>
            )}
          </svg>
        </button>

        {/* Video */}
        <button style={{ ...s.ctrl, background: videoOff ? "#ed4245" : "#3ba55d" }} onClick={toggleVideo} title={videoOff ? "Включить камеру" : "Выключить камеру"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            {videoOff ? (
              <><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 7l-5 3.5L21 14V7z"/><rect x="2" y="5" width="14" height="14" rx="2" fill="white" opacity="0.3"/></>
            ) : (
              <><rect x="2" y="5" width="14" height="14" rx="2" fill="white"/><path d="M23 7l-7 5 7 5V7z" fill="white"/></>
            )}
          </svg>
        </button>

        {/* Screen share */}
        <button style={{ ...s.ctrl, background: screenSharing ? "#5865f2" : "var(--bg-active)" }} onClick={toggleScreenShare} title="Демонстрация экрана">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </button>

        {/* Deafen */}
        <button style={{ ...s.ctrl, background: deafened ? "#ed4245" : "var(--bg-active)" }} onClick={toggleDeafen} title={deafened ? "Включить звук" : "Заглушить всех"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            {deafened ? (
              <><path d="M3 14h2a2 2 0 012 2v2a2 2 0 01-2 2H3V14z"/><path d="M21 14h-2a2 2 0 00-2 2v2a2 2 0 002 2h2V14z"/><path d="M3 14V9a9 9 0 0118 0v5"/><line x1="1" y1="1" x2="23" y2="23"/></>
            ) : (
              <><path d="M3 14h2a2 2 0 012 2v2a2 2 0 01-2 2H3V14z" fill="white"/><path d="M21 14h-2a2 2 0 00-2 2v2a2 2 0 002 2h2V14z" fill="white"/><path d="M3 14V9a9 9 0 0118 0v5"/></>
            )}
          </svg>
        </button>

        {/* Free mode (universe icon) */}
        <button style={{ ...s.ctrl, background: freeMode ? "#5865f2" : "var(--bg-active)" }} onClick={() => { setFreeMode(!freeMode); setTilePositions(new Map()); }} title="Свободный режим">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="10" ry="4"/><path d="M2 12h20"/>
          </svg>
        </button>

        {/* Settings */}
        <button style={{ ...s.ctrl, background: showSettings ? "#5865f2" : "var(--bg-active)" }} onClick={() => setShowSettings(!showSettings)} title="Настройки">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        </button>

        {/* Hangup */}
        <button style={{ ...s.ctrl, ...s.hangup }} onClick={handleEnd} title="Завершить звонок">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
            <path d="M12 9c-1.66 0-3 1.34-3 3v2H5c-1.1 0-2-.9-2-2v-1c0-3.87 3.13-7 7-7h4c3.87 0 7 3.13 7 7v1c0 1.1-.9 2-2 2h-4v-2c0-1.66-1.34-3-3-3z" transform="rotate(135 12 12)"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

function RemoteVideo({ entry, chat, enlarged, deafened, peerMuted, volume, onVolumeChange, onClick, freeMode, freePos, onStartDrag }: {
  entry: VideoEntry; chat: ChatOut; enlarged: boolean; deafened: boolean; peerMuted: boolean;
  volume: number; onVolumeChange: (v: number) => void; onClick: () => void;
  freeMode?: boolean; freePos?: { x: number; y: number; w: number; h: number } | null;
  onStartDrag?: (e: React.MouseEvent, mode: "move" | "resize") => void;
}) {
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
      style={{
        ...s.videoWrap,
        ...(!freeMode && enlarged ? s.enlarged : {}),
        ...(freeMode && freePos ? { position: "absolute" as const, left: freePos.x, top: freePos.y, width: freePos.w, height: freePos.h } : {}),
        cursor: freeMode ? "move" : "pointer",
        boxShadow: speaking ? "0 0 0 3px #57f287" : "none",
        transition: freeMode ? "none" : "box-shadow 0.15s",
      }}
      onMouseDown={(e) => freeMode && onStartDrag?.(e, "move")}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); setShowVolume(!showVolume); }}
    >
      <video ref={ref} autoPlay playsInline style={freeMode ? { width: "100%", height: "100%", objectFit: "cover" as const, display: "block" } : (enlarged ? s.videoEnlarged : s.video)} />
      {freeMode && <div style={s.resizeCorner} onMouseDown={(e) => { e.stopPropagation(); onStartDrag?.(e, "resize"); }} />}
      {entry.stream.getVideoTracks().length === 0 && member && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <CallAvatar name={member.username} url={member.avatar_url} />
        </div>
      )}
      <button
        style={s.pipBtn}
        onClick={(e) => {
          e.stopPropagation();
          if (ref.current && (ref.current as any).requestPictureInPicture) {
            (ref.current as any).requestPictureInPicture().catch(() => {});
          }
        }}
        title="В отдельное окно"
      >⧉</button>
      <span style={s.videoLabel}>{peerMuted ? "🔇 " : ""}{member?.username || "Участник"}</span>
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

function CallAvatar({ name, url }: { name: string; url: string | null }) {
  const colors = ["#5865f2", "#57f287", "#fee75c", "#ed4245", "#eb459e", "#faa61a", "#00b0f4"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const bg = colors[Math.abs(hash) % colors.length];
  return url ? (
    <img src={url.startsWith("http") ? url : `${BASE_URL}${url}`}
      style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", margin: "65px auto", display: "block" }} alt={name} />
  ) : (
    <div style={{ width: 80, height: 80, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 32, margin: "65px auto" }}>
      {name.charAt(0).toUpperCase()}
    </div>
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
