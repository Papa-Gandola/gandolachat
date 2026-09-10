import { Audio } from "expo-av";
import * as KeepAwake from "expo-keep-awake";
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, Vibration, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MediaStream, RTCView } from "react-native-webrtc";

import { Avatar } from "../components/Avatar";
import { HangupIcon, MicIcon, MicOffIcon, PhoneIcon, VideoIcon, VideoOffIcon } from "../components/icons";
import { useTheme } from "../theme";
import { UserOut, userApi } from "./api";
import { useAuth } from "./AuthContext";
import { startCallForegroundService, stopCallForegroundService } from "./callForegroundService";
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
interface PeerInfo {
  username: string;
  avatarUrl: string | null;
}

interface CallState {
  inCall: boolean;
  /** id чата, в котором идёт НАШ текущий звонок (null — не в звонке). */
  callChatId: number | null;
  /** Кто сейчас в созвоне по чатам: chat_id → [user_id] (по call_active). */
  activeCalls: Map<number, number[]>;
  startCall: (chatId: number, name: string, targetIds: number[], video?: boolean) => Promise<void>;
  /** Подключиться к уже идущему созвону этого чата. */
  joinOngoing: (chatId: number, name: string) => Promise<void>;
  /** Развернуть свёрнутый звонок. */
  expand: () => void;
}

const CallContext = createContext<CallState>({
  inCall: false,
  callChatId: null,
  activeCalls: new Map(),
  startCall: async () => {},
  joinOngoing: async () => {},
  expand: () => {},
});
export function useCall(): CallState {
  return useContext(CallContext);
}

const PALETTE = ["#ef5350", "#7c4dff", "#ffa726", "#26a69a", "#ec407a", "#5c6bc0", "#ff7043", "#3949ab", "#66bb6a"];
const colorFor = (id: number) => PALETTE[Math.abs(id) % PALETTE.length];

const PIP_W = 104;
const PIP_H = 150;

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
  const [minimized, setMinimized] = useState(false);
  const [callSec, setCallSec] = useState(0);
  const [callChatId, setCallChatId] = useState<number | null>(null);
  const [activeCalls, setActiveCalls] = useState<Map<number, number[]>>(new Map());
  const [peerInfo, setPeerInfo] = useState<Map<number, PeerInfo>>(new Map());
  const [peerVideoOff, setPeerVideoOff] = useState<Set<number>>(new Set());
  const activeRef = useRef(false);
  const ringRef = useRef<Audio.Sound | null>(null);
  // Чаты, где звонок уже взят этим юзером (на любом устройстве) — их
  // сигналы не должны поднимать «входящий» здесь. Чистится по call_end.
  const takenRef = useRef<Set<number>>(new Set());
  const insets = useSafeAreaInsets();

  // Секундомер звонка — для шапки и мини-бара свёрнутого режима.
  useEffect(() => {
    if (!inCall) {
      setCallSec(0);
      return;
    }
    const id = setInterval(() => setCallSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [inCall]);

  const sendVideoStatus = (off: boolean) => {
    const chatId = webrtcService.getChatId();
    if (chatId != null) wsService.send({ type: "video_status", chat_id: chatId, video_off: off });
  };

  // Foreground Service notification while a call is active. This is what
  // actually keeps the call running when the user backgrounds the app — the
  // OS no longer feels free to suspend our process because there's a visible
  // ongoing notification anchored to a service.
  useEffect(() => {
    if (!inCall) return;
    const peer = callName || "собеседником";
    startCallForegroundService(peer);
    return () => {
      stopCallForegroundService();
    };
  }, [inCall, callName]);
  // Keep the screen on + hold a wake lock for the duration of an active call.
  // Without this Android can suspend the JS thread when the user backgrounds
  // the app, which freezes the WebRTC render loop and effectively pauses the
  // call. expo-keep-awake calls into the Android WakeLock + KEEP_SCREEN_ON
  // window flag; cheap, automatically released when we deactivate.
  useEffect(() => {
    if (!inCall) return;
    KeepAwake.activateKeepAwakeAsync("gandola-call").catch(() => {});
    return () => {
      KeepAwake.deactivateKeepAwake("gandola-call").catch(() => {});
    };
  }, [inCall]);

  // Wire webrtc callbacks once we know who we are.
  useEffect(() => {
    if (!user) return;
    webrtcService.init(user.id);
    webrtcService.onStream = (uid, stream) => {
      setRemotes((prev) => [...prev.filter((r) => r.userId !== uid), { userId: uid, stream }]);
      setPeerInfo((prev) => {
        if (prev.has(uid)) return prev;
        userApi
          .getUser(uid)
          .then((r: { data: UserOut }) =>
            setPeerInfo((cur) => new Map(cur).set(uid, { username: r.data.username, avatarUrl: r.data.avatar_url })),
          )
          .catch(() => {});
        return prev;
      });
    };
    webrtcService.onPeerLeft = (uid) => setRemotes((prev) => prev.filter((r) => r.userId !== uid));
    webrtcService.onCallEnded = () => {
      activeRef.current = false;
      setInCall(false);
      setMinimized(false);
      setCallChatId(null);
      setLocalStream(null);
      setRemotes([]);
      setMuted(false);
      setVideoOff(false);
      setPeerVideoOff(new Set());
      setPeerInfo(new Map());
    };
  }, [user]);

  // Incoming-call detection + live peer video status.
  useEffect(() => {
    const onSignal = (d: Record<string, unknown>) => {
      if (activeRef.current || webrtcService.isInCall()) return;
      const chatId = d.chat_id as number;
      const fromUserId = d.from_user_id as number;
      // Звонок поднимает только ОФФЕР. Кандидаты/ансверы — это трафик чужого
      // разговора (например, к нашему же устройству, взявшему трубку) —
      // раньше они заставляли телефон звонить весь разговор.
      const sig = d.signal as { type?: string } | null;
      if (!sig || sig.type !== "offer") return;
      // Этот звонок уже взят/идёт на другом нашем устройстве — молчим
      // (в т.ч. на ре-офферы включения камеры посреди разговора).
      if (takenRef.current.has(chatId)) return;
      setIncoming((prev) => {
        if (prev) return prev;
        userApi
          .getUser(fromUserId)
          .then((r: { data: UserOut }) => setIncoming((cur) => (cur ? { ...cur, name: r.data.username } : cur)))
          .catch(() => {});
        return { chatId, fromUserId, name: "Входящий звонок" };
      });
    };
    const onEnd = (d: Record<string, unknown>) => {
      const chatId = d.chat_id as number;
      takenRef.current.delete(chatId);
      setIncoming((prev) => (prev && prev.chatId === chatId ? null : prev));
    };
    // Трубку взяли на другом нашем устройстве — здесь гасим входящий.
    const onTaken = (d: Record<string, unknown>) => {
      const chatId = d.chat_id as number;
      takenRef.current.add(chatId);
      if (webrtcService.isInCall()) return; // взяли именно тут — не трогаем
      setIncoming((prev) => (prev && prev.chatId === chatId ? null : prev));
    };
    // Реестр «кто в созвоне» для плашек в чатах. Сервер шлёт call_active на
    // каждый сигнал, при коннекте (снимок) и после каждого выхода из звонка;
    // пустой список = звонок кончился.
    const onActive = (d: Record<string, unknown>) => {
      const chatId = d.chat_id as number;
      const parts = Array.isArray(d.participants) ? (d.participants as number[]) : [];
      setActiveCalls((prev) => {
        const n = new Map(prev);
        if (parts.length === 0) n.delete(chatId);
        else n.set(chatId, parts);
        return n;
      });
    };
    const onVideoStatus = (d: Record<string, unknown>) => {
      const uid = d.user_id as number;
      const off = !!d.video_off;
      setPeerVideoOff((prev) => {
        const n = new Set(prev);
        if (off) n.add(uid);
        else n.delete(uid);
        return n;
      });
    };
    wsService.on("call_signal", onSignal);
    wsService.on("call_end", onEnd);
    wsService.on("call_taken", onTaken);
    wsService.on("call_active", onActive);
    wsService.on("video_status", onVideoStatus);
    return () => {
      wsService.off("call_signal", onSignal);
      wsService.off("call_end", onEnd);
      wsService.off("call_taken", onTaken);
      wsService.off("call_active", onActive);
      wsService.off("video_status", onVideoStatus);
    };
  }, []);

  // Входящий живёт максимум 20 секунд: дальше плашка и звук гаснут сами.
  // Сам звонок НЕ сбрасываем (никакого decline) — пока созвон жив, к нему
  // можно подключиться кнопкой звонка в чате.
  useEffect(() => {
    if (!incoming) return;
    const id = setTimeout(() => setIncoming(null), 20000);
    return () => clearTimeout(id);
  }, [incoming]);

  // Ringtone + vibration while a call is incoming OR while an outgoing call
  // hasn't been picked up yet (ringback for the caller).
  // Мягкий режим «как на компе»: короткий сигнал раз в 5 секунд вместо
  // непрерывной сирены, вибрация — один лёгкий импульс на сигнал (и только
  // для входящего). Через 20с входящий гаснет сам (эффект выше).
  useEffect(() => {
    const isIncoming = !!incoming && !inCall;
    const isOutgoingWaiting = inCall && remotes.length === 0;
    const ringing = isIncoming || isOutgoingWaiting;
    if (!ringing) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const buzz = () => {
      if (isIncoming) Vibration.vibrate(300);
    };
    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true });
        const { sound } = await Audio.Sound.createAsync(
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require("../../assets/ring.wav"),
          { shouldPlay: true, isLooping: false, volume: 0.6 },
        );
        if (cancelled) {
          sound.unloadAsync().catch(() => {});
          return;
        }
        ringRef.current = sound;
        buzz();
        interval = setInterval(() => {
          ringRef.current?.replayAsync().catch(() => {});
          buzz();
        }, 5000);
      } catch {
        // звук не завёлся — хотя бы вибрируем по тому же графику
        if (!cancelled) {
          buzz();
          interval = setInterval(buzz, 5000);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      Vibration.cancel();
      const s = ringRef.current;
      ringRef.current = null;
      if (s) s.stopAsync().then(() => s.unloadAsync()).catch(() => {});
    };
  }, [incoming, inCall, remotes.length]);

  const afterMedia = (ls: MediaStream) => {
    setLocalStream(ls);
    setInCall(true);
    // If the camera couldn't be acquired, reflect that locally and tell the peer.
    if (ls.getVideoTracks().length === 0) {
      setVideoOff(true);
      sendVideoStatus(true);
    }
  };

  // Камера по умолчанию ВЫКЛЮЧЕНА (как на десктопе): звонок стартует
  // аудио-онли, вебка — кнопкой. Меньше сюрпризов и меньше греет телефон.
  const startCall = async (chatId: number, name: string, targetIds: number[], video = false) => {
    activeRef.current = true;
    setCallName(name);
    setVideoOff(!video);
    setMuted(false);
    setMinimized(false);
    setCallChatId(chatId);
    try {
      afterMedia(await webrtcService.startCall(chatId, targetIds, video));
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
    setVideoOff(true);
    setMuted(false);
    setMinimized(false);
    setCallChatId(inc.chatId);
    try {
      afterMedia(await webrtcService.joinCall(inc.chatId, inc.fromUserId, false));
    } catch {
      activeRef.current = false;
    }
  };

  // Подключение к уже идущему созвону (плашка/кнопка в чате).
  const joinOngoing = async (chatId: number, name: string) => {
    if (activeRef.current || webrtcService.isInCall()) {
      setMinimized(false);
      return;
    }
    activeRef.current = true;
    setIncoming(null);
    setCallName(name);
    setVideoOff(true);
    setMuted(false);
    setMinimized(false);
    setCallChatId(chatId);
    try {
      afterMedia(await webrtcService.joinOngoing(chatId));
    } catch {
      activeRef.current = false;
    }
  };

  const expand = () => setMinimized(false);

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
  const toggleVideo = async () => {
    if (videoOff) {
      // Дорожки могло не быть вовсе (аудио-онли старт) — enableCamera сам
      // спросит разрешение, возьмёт камеру и раздаст её собеседникам.
      const ok = await webrtcService.enableCamera();
      if (!ok) return; // камеру не дали — остаёмся с аватаркой
      setVideoOff(false);
      sendVideoStatus(false);
    } else {
      webrtcService.disableCamera();
      setVideoOff(true);
      sendVideoStatus(true);
    }
  };

  // Group-call grid data: tile per remote participant.
  const remoteTiles = remotes.map((r) => ({
    userId: r.userId,
    stream: r.stream,
    info: peerInfo.get(r.userId),
    videoOff: peerVideoOff.has(r.userId),
  }));

  return (
    <CallContext.Provider value={{ inCall, callChatId, activeCalls, startCall, joinOngoing, expand }}>
      {children}

      {/* Incoming-call prompt */}
      <Modal visible={!!incoming && !inCall} transparent animationType="fade" onRequestClose={reject}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Avatar
            letter={(incoming?.name?.[0] ?? "?").toUpperCase()}
            size={96}
            bg={colorFor(incoming?.fromUserId ?? 0)}
          />
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.inkDim, marginTop: 18 }}>
            {theme.decorate ? "// входящий звонок" : "Входящий звонок"}
          </Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 22, fontWeight: "700", color: theme.colors.ink, marginTop: 6 }}>
            {incoming?.name ?? ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 56, marginTop: 52 }}>
            <View style={{ alignItems: "center" }}>
              <CircleBtn bg={theme.colors.danger} onPress={reject}>
                <HangupIcon color="#fff" size={26} />
              </CircleBtn>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkDim, marginTop: 8 }}>отклонить</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <CircleBtn bg={theme.colors.online} onPress={accept}>
                <PhoneIcon color="#fff" size={24} />
              </CircleBtn>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkDim, marginTop: 8 }}>принять</Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Active call. Кнопка «назад» СВОРАЧИВАЕТ звонок (мини-бар), а не
          кладёт трубку — раньше случайный back ронял звонок. */}
      <Modal visible={inCall && !minimized} animationType="slide" onRequestClose={() => setMinimized(true)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {/* Remote — full screen for 1:1, grid for groups */}
          {remoteTiles.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 16, color: theme.colors.inkDim }}>
                {theme.decorate ? `// звоним · ${callName}` : `Звоним · ${callName}`}
              </Text>
            </View>
          ) : (
            <RemoteGrid tiles={remoteTiles} fallbackName={callName} />
          )}

          {/* Local PiP (draggable) */}
          <LocalPip
            stream={localStream}
            videoOff={videoOff}
            meLetter={(user?.username?.[0] ?? "?").toUpperCase()}
            meAvatar={user?.avatar_url ?? null}
            meColor={colorFor(user?.id ?? 0)}
          />

          {/* Name + duration */}
          <View style={{ position: "absolute", top: 48, left: 16 }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 15, fontWeight: "700", color: "#fff" }}>{callName}</Text>
            {remoteTiles.length > 0 && (
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
                {fmtDur(callSec)}
              </Text>
            )}
          </View>

          {/* Свернуть: звонок продолжается, можно ходить по чатам и писать */}
          <Pressable
            onPress={() => setMinimized(true)}
            hitSlop={10}
            style={{
              position: "absolute",
              top: 44,
              right: 16,
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: "rgba(255,255,255,0.16)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 20, lineHeight: 22, fontWeight: "700" }}>⌄</Text>
          </Pressable>

          {/* Controls */}
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 44, flexDirection: "row", justifyContent: "center", gap: 20 }}>
            <CircleBtn bg={muted ? theme.colors.danger : "rgba(255,255,255,0.16)"} onPress={toggleMute}>
              {muted ? <MicOffIcon color="#fff" size={24} /> : <MicIcon color="#fff" size={24} />}
            </CircleBtn>
            <CircleBtn bg={videoOff ? theme.colors.danger : "rgba(255,255,255,0.16)"} onPress={toggleVideo}>
              {videoOff ? <VideoOffIcon color="#fff" size={24} /> : <VideoIcon color="#fff" size={24} />}
            </CircleBtn>
            <CircleBtn bg={theme.colors.danger} size={64} onPress={end}>
              <HangupIcon color="#fff" size={26} />
            </CircleBtn>
          </View>
        </View>
      </Modal>

      {/* В вебе звук собеседников играет через <video>-элементы RTCView —
          при свёрнутом окне звонка (Modal размонтирован) их надо держать
          живыми невидимками, иначе свернул = тишина. Натив звучит и так. */}
      {inCall && minimized && Platform.OS === "web" && (
        <View style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }} pointerEvents="none">
          {remoteTiles.map((t) => (
            <RTCView key={t.userId} streamURL={t.stream.toURL()} style={{ width: 1, height: 1 }} />
          ))}
        </View>
      )}

      {/* Мини-бар свёрнутого звонка: плавает поверх всего приложения,
          тап — развернуть, красная кнопка — положить трубку. */}
      {inCall && minimized && (
        <Pressable
          onPress={() => setMinimized(false)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            elevation: 12,
            paddingTop: insets.top,
            backgroundColor: theme.colors.online,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, gap: 10 }}>
            <PhoneIcon color="#0a0a0a" size={16} />
            <Text
              numberOfLines={1}
              style={{ flex: 1, fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: "#0a0a0a" }}
            >
              {callName} · {remoteTiles.length === 0 ? "звоним…" : fmtDur(callSec)} — вернуться
            </Text>
            <Pressable
              onPress={end}
              hitSlop={8}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: theme.colors.danger,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <HangupIcon color="#fff" size={15} />
            </Pressable>
          </View>
        </Pressable>
      )}
    </CallContext.Provider>
  );
}

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function CircleBtn({ children, onPress, bg, size = 56 }: { children: ReactNode; onPress: () => void; bg: string; size?: number }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}
    >
      {children}
    </Pressable>
  );
}

interface RemoteTileData {
  userId: number;
  stream: MediaStream;
  info: PeerInfo | undefined;
  videoOff: boolean;
}

// Adaptive grid of remote video tiles for group calls. Layout depends on
// the number of participants; single-remote falls through to a full-screen
// tile so 1:1 calls look the same as before.
function RemoteGrid({ tiles, fallbackName }: { tiles: RemoteTileData[]; fallbackName: string }) {
  return (
    <View style={{ ...StyleSheet.absoluteFillObject, flexDirection: "row", flexWrap: "wrap" }}>
      {tiles.map((t, i) => (
        <View key={t.userId} style={[{ padding: tiles.length > 1 ? 1 : 0 }, tileSize(tiles.length, i)]}>
          <RemoteTile tile={t} fallbackName={fallbackName} />
        </View>
      ))}
    </View>
  );
}

function tileSize(count: number, idx: number): { width: ViewStyle["width"]; height: ViewStyle["height"] } {
  if (count <= 1) return { width: "100%", height: "100%" };
  if (count === 2) return { width: "100%", height: "50%" };
  if (count === 3) {
    return idx === 0
      ? { width: "100%", height: "50%" }
      : { width: "50%", height: "50%" };
  }
  if (count === 4) return { width: "50%", height: "50%" };
  // 5-6: 3 columns x 2 rows
  return { width: "33.3333%", height: "50%" };
}

function RemoteTile({ tile, fallbackName }: { tile: RemoteTileData; fallbackName: string }) {
  const theme = useTheme();
  const { stream, info, videoOff, userId } = tile;
  const name = info?.username ?? fallbackName;
  const showVideo = !videoOff && stream.getVideoTracks().length > 0;
  return (
    <View style={{ flex: 1, backgroundColor: "#111", overflow: "hidden" }}>
      {/* RTCView рендерим ВСЕГДА: в вебе (PWA) это <video>, через который
          играет и ЗВУК. Если рендерить его только при включённой камере,
          собеседник без камеры в PWA был бы НЕМЫМ (главная причина «плохих
          звонков с веб-формы»). При выключенном видео поверх — аватарка. */}
      <RTCView streamURL={stream.toURL()} objectFit="cover" style={StyleSheet.absoluteFill} />
      {!showVideo && (
        <View
          style={{
            ...StyleSheet.absoluteFillObject,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#111",
          }}
        >
          <Avatar
            letter={(name?.[0] ?? "?").toUpperCase()}
            size={80}
            bg={colorFor(userId)}
            uri={info?.avatarUrl ?? null}
          />
        </View>
      )}
      {/* Tile label — only shows in group calls (2+ remotes) since a single
          full-screen tile already has the call header above. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 6,
          bottom: 6,
          paddingHorizontal: 6,
          paddingVertical: 2,
          backgroundColor: "rgba(0,0,0,0.55)",
          borderRadius: 4,
        }}
      >
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: "#fff" }} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </View>
  );
}

function LocalPip({
  stream,
  videoOff,
  meLetter,
  meAvatar,
  meColor,
}: {
  stream: MediaStream | null;
  videoOff: boolean;
  meLetter: string;
  meAvatar: string | null;
  meColor: string;
}) {
  const { width: SW, height: SH } = Dimensions.get("window");
  const startX = SW - PIP_W - 14;
  const startY = 90;
  const pan = useRef(new Animated.ValueXY({ x: startX, y: startY })).current;
  const value = useRef({ x: startX, y: startY });

  useEffect(() => {
    const id = pan.addListener((v) => (value.current = v));
    return () => pan.removeListener(id);
  }, [pan]);

  const responder = useRef(
    PanResponder.create({
      // Claim the gesture on touch-down so the native RTCView inside (which
      // would otherwise swallow it) doesn't block the drag.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        pan.setOffset({ x: value.current.x, y: value.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        const maxX = SW - PIP_W - 8;
        const maxY = SH - PIP_H - 120;
        const cx = Math.max(8, Math.min(maxX, value.current.x));
        const cy = Math.max(44, Math.min(maxY, value.current.y));
        Animated.spring(pan, { toValue: { x: cx, y: cy }, useNativeDriver: false, friction: 7 }).start();
      },
    }),
  ).current;

  return (
    <Animated.View
      {...responder.panHandlers}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: PIP_W,
        height: PIP_H,
        borderRadius: 10,
        overflow: "hidden",
        backgroundColor: "#222",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.2)",
        transform: pan.getTranslateTransform(),
      }}
    >
      {/* pointerEvents="none" lets touches fall through to the PanResponder on
          the parent Animated.View. Without it, RTCView (a native SurfaceView)
          eats the gesture and the PiP becomes undraggable. */}
      <View pointerEvents="none" style={{ flex: 1 }}>
        {stream && !videoOff ? (
          // No zOrder — with positive zOrder the SurfaceView can outlive its
          // React unmount on Android, sticking the camera frame over the avatar
          // when the user turns video off.
          <RTCView streamURL={stream.toURL()} objectFit="cover" mirror style={{ flex: 1 }} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Avatar letter={meLetter} size={56} bg={meColor} uri={meAvatar} />
          </View>
        )}
      </View>
    </Animated.View>
  );
}
