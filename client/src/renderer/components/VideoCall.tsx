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
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const [minimized, setMinimized] = useState(false);
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
      // Stop screen share — restore camera track to peers
      screenStream?.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
      setScreenSharing(false);
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const camTrack = camStream.getVideoTracks()[0];
        webrtcService.replaceVideoTrack(camTrack);
        const ls = webrtcService.getLocalStream();
        if (ls) {
          const oldTrack = ls.getVideoTracks()[0];
          if (oldTrack) { ls.removeTrack(oldTrack); oldTrack.stop(); }
          ls.addTrack(camTrack);
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = webrtcService.getLocalStream();
      } catch {}
    } else {
      try {
        const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
        const screenTrack = stream.getVideoTracks()[0];
        // Replace camera track with screen track in all peers
        webrtcService.replaceVideoTrack(screenTrack);
        // Show screen locally
        setScreenStream(stream);
        setScreenSharing(true);
        // Update local video to show screen
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        screenTrack.onended = () => {
          setScreenStream(null);
          setScreenSharing(false);
          // Restore camera
          navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then((camStream) => {
            const camTrack = camStream.getVideoTracks()[0];
            webrtcService.replaceVideoTrack(camTrack);
            const ls = webrtcService.getLocalStream();
            if (ls) {
              const oldTrack = ls.getVideoTracks()[0];
              if (oldTrack) { ls.removeTrack(oldTrack); oldTrack.stop(); }
              ls.addTrack(camTrack);
            }
            if (localVideoRef.current) localVideoRef.current.srcObject = webrtcService.getLocalStream();
          }).catch(() => {});
        };
      } catch {}
    }
  }

  function changePeerVolume(userId: number, volume: number) {
    setPeerVolumes((prev) => new Map(prev).set(userId, volume));
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
              {muted ? "🔇" : "🎤"}
            </button>
            <button style={{ ...s.miniBtn, background: "#ed4245" }} onClick={(e) => { e.stopPropagation(); handleEnd(); }}>
              ✕
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div style={s.overlay}>
      <div style={s.header}>
        <span style={s.title}>Видеозвонок</span>
        <span style={s.subtitle}>{callName}</span>
        <button style={s.minimizeBtn} onClick={() => setMinimized(true)} title="Свернуть">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><polyline points="4 14 10 20 16 14"/><line x1="10" y1="20" x2="10" y2="4"/></svg>
        </button>
      </div>

      <div style={s.videoGrid}>
        {/* Local video */}
        <div
          style={{ ...s.videoWrap, ...(enlarged === "self" ? s.enlarged : {}), boxShadow: selfSpeaking && !muted ? "0 0 0 3px #57f287" : "none", transition: "box-shadow 0.15s", cursor: "pointer" }}
          onClick={() => setEnlarged(enlarged === "self" ? null : "self")}
        >
          <video ref={localVideoRef} autoPlay muted playsInline style={s.video} />
          <span style={s.videoLabel}>Вы</span>
        </div>

        {/* Screen share tile */}
        {screenStream && (
          <div
            style={{ ...s.videoWrap, ...(enlarged === "screen" ? s.enlarged : {}), cursor: "pointer", border: "2px solid #5865f2" }}
            onClick={() => setEnlarged(enlarged === "screen" ? null : "screen")}
          >
            <video ref={screenVideoRef} autoPlay muted playsInline style={s.video} />
            <span style={s.videoLabel}>Ваш экран</span>
          </div>
        )}

        {/* Remote videos */}
        {remoteVideos.map((entry) => (
          <RemoteVideo
            key={entry.userId}
            entry={entry}
            chat={chat}
            enlarged={enlarged === String(entry.userId)}
            deafened={deafened}
            peerMuted={mutedPeers.has(entry.userId)}
            volume={peerVolumes.get(entry.userId) ?? 100}
            onVolumeChange={(v) => changePeerVolume(entry.userId, v)}
            onClick={() => setEnlarged(enlarged === String(entry.userId) ? null : String(entry.userId))}
          />
        ))}

        {remoteVideos.length === 0 && (
          <div style={s.waiting}>
            <span>Ожидание участников...</span>
          </div>
        )}
      </div>

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
                const ls = webrtcService.getLocalStream();
                ls?.getAudioTracks().forEach((t) => {
                  if ((t as any).applyConstraints) {
                    // Volume isn't a standard constraint but we can try gain
                  }
                });
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

function RemoteVideo({ entry, chat, enlarged, deafened, peerMuted, volume, onVolumeChange, onClick }: {
  entry: VideoEntry; chat: ChatOut; enlarged: boolean; deafened: boolean; peerMuted: boolean;
  volume: number; onVolumeChange: (v: number) => void; onClick: () => void;
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
        ...(enlarged ? s.enlarged : {}),
        cursor: "pointer",
        boxShadow: speaking ? "0 0 0 3px #57f287" : "none",
        transition: "box-shadow 0.15s",
      }}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); setShowVolume(!showVolume); }}
    >
      <video ref={ref} autoPlay playsInline style={s.video} />
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
    position: "absolute", bottom: 56, left: 240, right: 0, zIndex: 100,
    background: "#3ba55d", display: "flex", alignItems: "center",
    justifyContent: "space-between", padding: "8px 16px",
    cursor: "pointer",
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
  videoWrap: {
    position: "relative", borderRadius: 8, overflow: "hidden",
    background: "#18191c", transition: "all 0.3s",
  },
  enlarged: { width: "60%", maxWidth: 640 },
  video: { width: 280, height: 210, objectFit: "cover", display: "block" },
  videoLabel: {
    position: "absolute", bottom: 8, left: 8,
    background: "rgba(0,0,0,0.6)", color: "#fff",
    padding: "2px 8px", borderRadius: 4, fontSize: 12,
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
