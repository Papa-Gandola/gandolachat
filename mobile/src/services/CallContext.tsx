import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { MediaStream, RTCView } from "react-native-webrtc";

import { useTheme } from "../theme";
import { userApi } from "./api";
import { useAuth } from "./AuthContext";
import { webrtcService } from "./webrtc";
import { wsService } from "./ws";

interface Incoming {
  chatId: number;
  fromUserId: number;
  name: string;
}
interface Remote {
  userId: number;
  stream: MediaStream;
}

interface CallState {
  inCall: boolean;
  // Start a call. targetIds = the other participants (for a DM, just the peer).
  startCall: (chatId: number, name: string, targetIds: number[], video?: boolean) => Promise<void>;
}

const CallContext = createContext<CallState>({ inCall: false, startCall: async () => {} });

export function useCall(): CallState {
  return useContext(CallContext);
}

export function CallProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const { user } = useAuth();
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [inCall, setInCall] = useState(false);
  const [callName, setCallName] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    webrtcService.init(user.id);
    webrtcService.onStream = (uid, stream) =>
      setRemotes((prev) => [...prev.filter((r) => r.userId !== uid), { userId: uid, stream }]);
    webrtcService.onPeerLeft = (uid) => setRemotes((prev) => prev.filter((r) => r.userId !== uid));
    webrtcService.onCallEnded = () => {
      activeRef.current = false;
      setInCall(false);
      setLocalStream(null);
      setRemotes([]);
      setMuted(false);
      setVideoOff(false);
    };
  }, [user]);

  // Detect incoming calls (a call_signal while we're not already in a call).
  useEffect(() => {
    const onSignal = (d: Record<string, unknown>) => {
      if (activeRef.current || webrtcService.isInCall()) return;
      const chatId = d.chat_id as number;
      const fromUserId = d.from_user_id as number;
      setIncoming((prev) => {
        if (prev) return prev;
        userApi
          .getUser(fromUserId)
          .then((r) => setIncoming((cur) => (cur ? { ...cur, name: r.data.username } : cur)))
          .catch(() => {});
        return { chatId, fromUserId, name: "Входящий звонок" };
      });
    };
    const onEnd = (d: Record<string, unknown>) => {
      const chatId = d.chat_id as number;
      setIncoming((prev) => (prev && prev.chatId === chatId ? null : prev));
    };
    wsService.on("call_signal", onSignal);
    wsService.on("call_end", onEnd);
    return () => {
      wsService.off("call_signal", onSignal);
      wsService.off("call_end", onEnd);
    };
  }, []);

  const startCall = async (chatId: number, name: string, targetIds: number[], video = true) => {
    activeRef.current = true;
    setCallName(name);
    setVideoOff(!video);
    setMuted(false);
    try {
      const ls = await webrtcService.startCall(chatId, targetIds, video);
      setLocalStream(ls);
      setInCall(true);
    } catch {
      activeRef.current = false;
    }
  };

  const accept = async () => {
    if (!incoming) return;
    const inc = incoming;
    setIncoming(null);
    activeRef.current = true;
    setCallName(inc.name);
    setVideoOff(false);
    setMuted(false);
    try {
      const ls = await webrtcService.joinCall(inc.chatId, inc.fromUserId, true);
      setLocalStream(ls);
      setInCall(true);
    } catch {
      activeRef.current = false;
    }
  };

  const reject = () => {
    if (!incoming) return;
    wsService.send({ type: "call_end", chat_id: incoming.chatId, declined: true });
    setIncoming(null);
  };

  const end = () => webrtcService.endCall();
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    webrtcService.setMuted(m);
  };
  const toggleVideo = () => {
    const v = !videoOff;
    setVideoOff(v);
    webrtcService.setVideoOff(v);
  };

  return (
    <CallContext.Provider value={{ inCall, startCall }}>
      {children}

      {/* Incoming-call prompt */}
      <Modal visible={!!incoming && !inCall} transparent animationType="fade" onRequestClose={reject}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 14, color: theme.colors.inkDim }}>
            {theme.decorate ? "// входящий звонок" : "Входящий звонок"}
          </Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 24, fontWeight: "700", color: theme.colors.ink, marginTop: 10 }}>
            {incoming?.name ?? ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 40, marginTop: 48 }}>
            <Pressable onPress={reject} style={{ alignItems: "center" }}>
              <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: theme.colors.danger, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 28 }}>✕</Text>
              </View>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkDim, marginTop: 8 }}>отклонить</Text>
            </Pressable>
            <Pressable onPress={accept} style={{ alignItems: "center" }}>
              <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: theme.colors.online, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 28 }}>📞</Text>
              </View>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkDim, marginTop: 8 }}>принять</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Active call */}
      <Modal visible={inCall} animationType="slide" onRequestClose={end}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap" }}>
            {remotes.length === 0 ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 16, color: theme.colors.inkDim }}>
                  {theme.decorate ? `// звоним · ${callName}` : `Звоним · ${callName}`}
                </Text>
              </View>
            ) : (
              remotes.map((r) => (
                <RTCView
                  key={r.userId}
                  streamURL={r.stream.toURL()}
                  objectFit="cover"
                  style={{ flex: 1, minWidth: "50%", minHeight: "50%", backgroundColor: "#111" }}
                />
              ))
            )}
          </View>

          {/* Local PiP */}
          {localStream && !videoOff ? (
            <RTCView
              streamURL={localStream.toURL()}
              objectFit="cover"
              mirror
              zOrder={1}
              style={{ position: "absolute", top: 48, right: 16, width: 96, height: 140, borderRadius: 8, backgroundColor: "#222" }}
            />
          ) : null}

          {/* Header */}
          <View style={{ position: "absolute", top: 48, left: 16 }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 14, fontWeight: "700", color: "#fff" }}>{callName}</Text>
          </View>

          {/* Controls */}
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 40, flexDirection: "row", justifyContent: "center", gap: 22 }}>
            <CallCtrl label="🎤" active={!muted} onPress={toggleMute} dim={muted} />
            <CallCtrl label="📷" active={!videoOff} onPress={toggleVideo} dim={videoOff} />
            <Pressable onPress={end} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.danger, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 26 }}>📵</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </CallContext.Provider>
  );
}

function CallCtrl({ label, onPress, dim }: { label: string; active: boolean; onPress: () => void; dim: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: dim ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.35)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: 24, opacity: dim ? 0.5 : 1 }}>{label}</Text>
    </Pressable>
  );
}
