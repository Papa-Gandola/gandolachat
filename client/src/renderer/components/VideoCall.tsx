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
        <button style={{ ...s.ctrl, background: muted ? "var(--danger)" : "var(--bg-active)" }} onClick={toggleMute}>
          {muted ? "🔇" : "🎤"}
        </button>
        <button style={{ ...s.ctrl, background: videoOff ? "var(--danger)" : "var(--bg-active)" }} onClick={toggleVideo}>
          {videoOff ? "📵" : "📹"}
        </button>
        <button style={{ ...s.ctrl, background: "var(--danger)" }} onClick={handleEnd}>
          📵
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
    width: 56, height: 56, borderRadius: "50%",
    fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center",
  },
};
