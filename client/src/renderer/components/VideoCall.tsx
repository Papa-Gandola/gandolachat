import React, { useEffect, useRef, useState } from "react";
import { ChatOut, UserOut } from "../services/api";
import { webrtcService } from "../services/webrtc";
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
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const started = useRef(false);

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
    setMuted(!muted);
  }

  function toggleVideo() {
    const stream = webrtcService.getLocalStream();
    stream?.getVideoTracks().forEach((t) => (t.enabled = videoOff));
    setVideoOff(!videoOff);
  }

  return (
    <div style={s.overlay}>
      <div style={s.header}>
        <span style={s.title}>📹 Видеозвонок</span>
        <span style={s.subtitle}>{chat.is_group ? chat.name : chat.members.find((m) => m.id !== currentUser.id)?.username}</span>
      </div>

      <div style={s.videoGrid}>
        {/* Local video */}
        <div style={s.videoWrap}>
          <video ref={localVideoRef} autoPlay muted playsInline style={s.video} />
          <span style={s.videoLabel}>Вы</span>
        </div>

        {/* Remote videos */}
        {remoteVideos.map((entry) => (
          <RemoteVideo key={entry.userId} entry={entry} chat={chat} />
        ))}

        {/* Waiting */}
        {remoteVideos.length === 0 && (
          <div style={s.waiting}>
            <span>⏳ Ожидание участников...</span>
          </div>
        )}
      </div>

      <div style={s.controls}>
        <button style={{ ...s.ctrl, background: muted ? "#ed4245" : "#3ba55d" }} onClick={toggleMute} title={muted ? "Включить микрофон" : "Выключить микрофон"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            {muted ? (
              <path d="M12 1a4 4 0 00-4 4v6a4 4 0 008 0V5a4 4 0 00-4-4zM2 2l20 20M17 11a5 5 0 01-10 0M12 19v4M8 23h8" stroke="white" fill="none" strokeWidth="2" strokeLinecap="round"/>
            ) : (
              <>
                <rect x="9" y="1" width="6" height="13" rx="3" />
                <path d="M5 11a7 7 0 0014 0M12 19v4M8 23h8" stroke="white" fill="none" strokeWidth="2" strokeLinecap="round"/>
              </>
            )}
          </svg>
        </button>
        <button style={{ ...s.ctrl, background: videoOff ? "#ed4245" : "#3ba55d" }} onClick={toggleVideo} title={videoOff ? "Включить камеру" : "Выключить камеру"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            {videoOff ? (
              <path d="M2 2l20 20M17 13V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h10M23 7l-6 4 6 4V7z" stroke="white" fill="none" strokeWidth="2" strokeLinecap="round"/>
            ) : (
              <>
                <rect x="2" y="5" width="14" height="14" rx="2" />
                <path d="M23 7l-7 5 7 5V7z" />
              </>
            )}
          </svg>
        </button>
        <button style={{ ...s.ctrl, ...s.hangup }} onClick={handleEnd} title="Завершить звонок">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
            <path d="M12 9c-1.66 0-3 1.34-3 3v2H5c-1.1 0-2-.9-2-2v-1c0-3.87 3.13-7 7-7h4c3.87 0 7 3.13 7 7v1c0 1.1-.9 2-2 2h-4v-2c0-1.66-1.34-3-3-3z" transform="rotate(135 12 12)"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

function RemoteVideo({ entry, chat }: { entry: VideoEntry; chat: ChatOut }) {
  const ref = useRef<HTMLVideoElement>(null);
  const member = chat.members.find((m) => m.id === entry.userId);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = entry.stream;
  }, [entry.stream]);

  return (
    <div style={s.videoWrap}>
      <video ref={ref} autoPlay playsInline style={s.video} />
      <span style={s.videoLabel}>{member?.username || "Участник"}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "absolute", inset: 0, zIndex: 100,
    background: "rgba(0,0,0,0.92)",
    display: "flex", flexDirection: "column",
    alignItems: "center",
  },
  header: { padding: "16px 0 8px", textAlign: "center" },
  title: { color: "#fff", fontWeight: 700, fontSize: 18, display: "block" },
  subtitle: { color: "var(--text-muted)", fontSize: 14 },
  videoGrid: {
    flex: 1, width: "100%", display: "flex", flexWrap: "wrap",
    alignItems: "center", justifyContent: "center", gap: 12, padding: 16,
  },
  videoWrap: { position: "relative", borderRadius: 8, overflow: "hidden", background: "#18191c" },
  video: { width: 280, height: 210, objectFit: "cover", display: "block" },
  videoLabel: {
    position: "absolute", bottom: 8, left: 8,
    background: "rgba(0,0,0,0.6)", color: "#fff",
    padding: "2px 8px", borderRadius: 4, fontSize: 12,
  },
  waiting: { color: "var(--text-muted)", fontSize: 16 },
  controls: { display: "flex", gap: 16, padding: "16px 0 24px" },
  ctrl: {
    width: 52, height: 52, borderRadius: "50%",
    fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", cursor: "pointer", transition: "opacity 0.15s",
  },
  hangup: {
    background: "#ed4245", width: 60, height: 52, borderRadius: 26,
  },
};
