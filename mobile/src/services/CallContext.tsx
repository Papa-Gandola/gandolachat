import { Audio } from "expo-av";
import * as KeepAwake from "expo-keep-awake";
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Animated, AppState, Dimensions, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, Vibration, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import InCallManager from "react-native-incall-manager";
import { MediaStream, RTCView } from "react-native-webrtc";

import { Avatar } from "../components/Avatar";
import { HangupIcon, MicIcon, MicOffIcon, PhoneIcon, ScreenIcon, VideoIcon, VideoOffIcon } from "../components/icons";
import { useTheme } from "../theme";
import { UserOut, userApi } from "./api";
import { useAuth } from "./AuthContext";
import {
  applyVolume,
  DEFAULT_GAIN,
  getAllVolumes,
  loadCallAudio,
  getVolume,
  isSpeakerOn,
  setSpeakerPref,
  setVolume as persistVolume,
  stepVolume,
  volumeLabel,
} from "./callAudio";
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

/**
 * Маршрут звука звонка. ВАЖНО: «динамик выключен» — это НЕ `false`.
 *
 * В react-native-incall-manager `setForceSpeakerphoneOn(false)` уходит в
 * натив как flag=-1, а это «принудительно EARPIECE»: выбранное таким
 * образом устройство в updateAudioDeviceState выигрывает у Bluetooth и
 * проводной гарнитуры. Человек в наушниках слышал бы звонок из трубки
 * телефона, и переключить это было бы нечем — кнопка знает только
 * «разговорный ↔ громкая связь». Не-boolean даёт flag=0 — «маршрут по
 * умолчанию», где гарнитура приоритетнее динамиков. Типы библиотеки
 * объявляют boolean, отсюда каст.
 */
function forceSpeaker(on: boolean): void {
  try {
    (InCallManager.setForceSpeakerphoneOn as unknown as (flag?: boolean | null) => void)(
      on ? true : null,
    );
  } catch {
    // Веб-стаб или нет натива — маршрутом распоряжается система
  }
}

export function CallProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const { user } = useAuth();
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [inCall, setInCall] = useState(false);
  const [callName, setCallName] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  // Экраны, которые шарят с десктопа (приём; сами не шарим). Тап по экрану
  // разворачивает его на весь звонок, участники уезжают в узкую полосу.
  const [screens, setScreens] = useState<Remote[]>([]);
  const [screenFocus, setScreenFocus] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [minimized, setMinimized] = useState(false);
  const [callSec, setCallSec] = useState(0);
  const [callChatId, setCallChatId] = useState<number | null>(null);
  const [activeCalls, setActiveCalls] = useState<Map<number, number[]>>(new Map());
  const [peerInfo, setPeerInfo] = useState<Map<number, PeerInfo>>(new Map());
  const [peerVideoOff, setPeerVideoOff] = useState<Set<number>>(new Set());
  // Громкая связь и персональная громкость участников (см. callAudio.ts).
  const [speakerOn, setSpeakerOn] = useState(isSpeakerOn());
  const [volumes, setVolumes] = useState<Map<number, number>>(() => getAllVolumes());
  const volumesRef = useRef<Map<number, number>>(volumes);
  // Чей регулятор раскрыт. Живёт в провайдере, а не в плитке: Modal
  // активного звонка при сворачивании размонтируется, и локальный стейт
  // плитки терялся бы на каждом «свернул — ответил в чате — развернул».
  const [volOpenFor, setVolOpenFor] = useState<number | null>(null);
  // Трогал ли пользователь динамик В ЭТОМ звонке: если нет — включение
  // своей камеры само переводит звук на громкую связь (с видео телефон
  // держат перед собой, а не у уха). Ручной выбор не переигрываем.
  const speakerTouchedRef = useRef(false);
  const activeRef = useRef(false);
  const ringRef = useRef<Audio.Sound | null>(null);
  // Ref-зеркала для WS-хендлеров (их замыкание живёт от первого рендера).
  // «Я уже в этом звонке где-то» выводится из РЕЕСТРА call_active
  // (membership) — реестр самоочищается сервером, «вечной глушилки» после
  // пропущенного call_end не бывает.
  const activeCallsRef = useRef<Map<number, number[]>>(new Map());
  const userIdRef = useRef<number | null>(null);
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);
  const insets = useSafeAreaInsets();

  // Сохранённые настройки звука (маршрут + персональные громкости) лежат в
  // сторе: стартовое состояние взято из пустого кэша, поэтому после
  // прогрева синхронизируем его один раз на запуск приложения.
  useEffect(() => {
    void loadCallAudio().then(() => {
      setSpeakerOn(isSpeakerOn());
      setVolumes(getAllVolumes());
    });
  }, []);

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
    return () => {
      stopCallForegroundService();
    };
  }, [inCall]);
  // Уведомление сервиса переобъявляем и при включении/выключении камеры:
  // с Android 14 тип сервиса определяет, ЧТО ему позволено в фоне, и без
  // типа camera система отбирает камеру при сворачивании — у собеседника
  // застывал кадр. Отдельно от эффекта выше, чтобы тумблер камеры не
  // дёргал stop/start самого сервиса.
  useEffect(() => {
    if (!inCall) return;
    void startCallForegroundService(callName || "собеседником", !videoOff);
  }, [inCall, callName, videoOff]);
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
    webrtcService.onScreenStream = (uid, stream) => {
      setScreens((prev) => [...prev.filter((s) => s.userId !== uid), { userId: uid, stream }]);
      // Имя шарящего могло ещё не подгрузиться (экран пришёл раньше вебки)
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
    webrtcService.onScreenEnded = (uid) => setScreens((prev) => prev.filter((s) => s.userId !== uid));
    webrtcService.onCallEnded = () => {
      activeRef.current = false;
      setInCall(false);
      setMinimized(false);
      setCallChatId(null);
      setLocalStream(null);
      setRemotes([]);
      setScreens([]);
      setScreenFocus(false);
      setMuted(false);
      setVideoOff(false);
      setFacing("user");
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
      const sig = d.signal as { type?: string; renegotiate?: boolean } | null;
      if (!sig || sig.type !== "offer") return;
      // Я уже в этом звонке на другом устройстве (реестр call_active) —
      // молчим, в т.ч. на ре-офферы включения камеры посреди разговора.
      const me = userIdRef.current;
      if (me != null && (activeCallsRef.current.get(chatId) ?? []).includes(me)) return;
      setIncoming((prev) => {
        if (prev) return prev;
        userApi
          .getUser(fromUserId)
          .then((r: { data: UserOut }) => setIncoming((cur) => (cur ? { ...cur, name: r.data.username } : cur)))
          .catch(() => {});
        return { chatId, fromUserId, name: "Входящий звонок" };
      });
    };
    // Гасим входящий по call_end ТОЛЬКО когда звонить дальше нечего: отбой
    // сделал я сам (другое моё устройство) или сам ЗВОНЯЩИЙ отменил вызов.
    // Выход третьего участника группы звонок не заканчивает.
    const onEnd = (d: Record<string, unknown>) => {
      const chatId = d.chat_id as number;
      const fromId = d.from_user_id as number;
      setIncoming((prev) => {
        if (!prev || prev.chatId !== chatId) return prev;
        const me = userIdRef.current;
        if (fromId === me || fromId === prev.fromUserId) return null;
        return prev;
      });
    };
    // Трубку взяли на другом нашем устройстве — здесь гасим входящий.
    const onTaken = (d: Record<string, unknown>) => {
      const chatId = d.chat_id as number;
      if (webrtcService.isInCall()) return; // взяли именно тут — не трогаем
      setIncoming((prev) => (prev && prev.chatId === chatId ? null : prev));
    };
    // Реестр «кто в созвоне». Сервер шлёт call_active при смене состава,
    // снимком при коннекте и после каждого выхода/таймаута; пустой список =
    // конец звонка (авторитетный) — гасим и входящий. Дедуп по составу.
    const onActive = (d: Record<string, unknown>) => {
      const chatId = d.chat_id as number;
      const parts = Array.isArray(d.participants) ? (d.participants as number[]) : [];
      const prevParts = activeCallsRef.current.get(chatId) ?? [];
      if (parts.length === prevParts.length && parts.every((p) => prevParts.includes(p))) return;
      const next = new Map(activeCallsRef.current);
      if (parts.length === 0) next.delete(chatId);
      else next.set(chatId, parts);
      activeCallsRef.current = next;
      setActiveCalls(next);
      if (parts.length === 0) {
        setIncoming((prev) => (prev && prev.chatId === chatId ? null : prev));
      }
    };
    // Реконнект: реестр мог протухнуть (звонок кончился, пока были оффлайн).
    // Сбрасываем — сервер тут же шлёт свежий снимок живых звонков.
    const onOpen = () => {
      activeCallsRef.current = new Map();
      setActiveCalls(new Map());
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
    wsService.on("_ws_open", onOpen);
    return () => {
      wsService.off("call_signal", onSignal);
      wsService.off("call_end", onEnd);
      wsService.off("call_taken", onTaken);
      wsService.off("call_active", onActive);
      wsService.off("video_status", onVideoStatus);
      wsService.off("_ws_open", onOpen);
    };
  }, []);

  // Входящий живёт максимум 20 секунд: дальше плашка и звук гаснут сами.
  // Сам звонок НЕ сбрасываем (никакого decline) — пока созвон жив, к нему
  // можно подключиться кнопкой звонка в чате. Ключ — chatId, а не объект:
  // подгрузка имени звонящего не должна перезапускать таймер.
  useEffect(() => {
    if (incoming == null) return;
    const id = setTimeout(() => setIncoming(null), 20000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.chatId]);

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
    // Ключ — chatId, не объект: подгрузка имени звонящего не должна
    // рестартовать звук (слышался бы «двойной» сигнал в первую секунду).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.chatId, inCall, remotes.length]);

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
    // Уже в звонке (например, свёрнутом) — не начинаем второй: это
    // перезаписало бы поток/чат и оставило бы микрофон первого звонка
    // захваченным навсегда. Просто разворачиваем текущий.
    if (activeRef.current || webrtcService.isInCall()) {
      setMinimized(false);
      return;
    }
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
      // Сторожок мёртвого входа: call_join в звонок, который успел
      // кончиться, сервер тихо игнорирует. Если за 12с нас так и не
      // зарегистрировали в составе — кладём пустой звонок сами, а не сидим
      // «Звоним…» с захваченным микрофоном.
      setTimeout(() => {
        const me = userIdRef.current;
        const inRoster = me != null && (activeCallsRef.current.get(chatId) ?? []).includes(me);
        if (!inRoster && webrtcService.getChatId() === chatId) {
          webrtcService.endCall();
        }
      }, 12000);
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

  // Возврат из фона: пока приложение спало, сеть могла смениться, а
  // соединения — развалиться. Просим сервис проверить и восстановить
  // (ICE-restart упавших) — не ждём, пока человек сам заметит тишину.
  useEffect(() => {
    if (!inCall) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") webrtcService.recover("foreground");
    });
    return () => sub.remove();
  }, [inCall]);

  // Возврат из фона с включённой камерой: если Андроид успел её отобрать
  // (старые сборки без типа сервиса camera — и мало ли что ещё), дорожка
  // остаётся в потоке, но кадров не даёт, и собеседник видит застывшую
  // картинку ДАЖЕ после возврата — люди лечили это ручным «выкл/вкл».
  // Делаем то же самое сами. Проверяем с задержкой: сразу после resume
  // дорожка может числиться muted мгновение, дёргать её зря незачем.
  useEffect(() => {
    if (!inCall || videoOff || Platform.OS === "web") return;
    let cancelled = false;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setTimeout(async () => {
        if (cancelled || !webrtcService.isCameraDead()) return;
        const ok = await webrtcService.restartCamera();
        if (cancelled) return;
        if (!ok) {
          // Камеру забрали насовсем (занял кто-то другой) — честно
          // показываем «камера выключена», а не вечный стоп-кадр.
          setVideoOff(true);
          sendVideoStatus(true);
        }
      }, 600);
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [inCall, videoOff]);

  // Аудиосессия звонка (андроидный AudioManager через InCallManager).
  //
  // Забираем её ТОЛЬКО когда кто-то реально подключился, а не по факту
  // inCall: и наш рингтон входящего, и гудок исходящего играют через
  // expo-av, а режим IN_COMMUNICATION забирает аудиофокус и увёл бы их в
  // разговорный динамик («звонилка молчит»). Сессию держим до конца
  // звонка: временный уход remotes в ноль (реконнект пира) её не роняет.
  const audioSessionRef = useRef(false);
  useEffect(() => {
    if (!inCall || remotes.length === 0 || audioSessionRef.current) return;
    audioSessionRef.current = true;
    try {
      InCallManager.start({ media: "audio" });
    } catch {
      // Нет модуля (веб-стаб) — звук останется на системном маршруте
    }
    forceSpeaker(speakerOn);
  }, [inCall, remotes.length, speakerOn]);

  // Конец звонка: отдаём сессию и сбрасываем ВСЁ, что решали на лету.
  // speakerOn обязателен к откату: авто-переезд на громкую связь при
  // включении камеры в стор не пишется, но жил бы в стейте и молча
  // становился бы дефолтом следующих звонков.
  useEffect(() => {
    if (!inCall) return;
    return () => {
      if (audioSessionRef.current) {
        try {
          InCallManager.stop();
        } catch {
          // s'ok
        }
        audioSessionRef.current = false;
      }
      speakerTouchedRef.current = false;
      setSpeakerOn(isSpeakerOn());
      setVolOpenFor(null);
    };
  }, [inCall]);

  // Персональная громкость: применяем при КАЖДОЙ смене состава и приходе
  // дорожек. Аудиодорожка участника может появиться позже самого участника
  // (аудио-старт, ренегосиация), поэтому одного раза на входе мало.
  useEffect(() => {
    volumesRef.current = volumes;
    if (!inCall) return;
    for (const r of remotes) applyVolume(r.stream, volumes.get(r.userId) ?? getVolume(r.userId));
  }, [inCall, remotes, volumes]);

  const toggleSpeaker = () => {
    const on = !speakerOn;
    speakerTouchedRef.current = true;
    setSpeakerOn(on);
    void setSpeakerPref(on);
    forceSpeaker(on);
  };

  /** −/+ громкости конкретного участника (шкала в callAudio).
   *  Читаем из ref-зеркала: два быстрых тапа в одном кадре видели бы одно
   *  и то же состояние и давали один шаг вместо двух. */
  const changeVolume = (userId: number, dir: 1 | -1) => {
    const cur = volumesRef.current.get(userId) ?? getVolume(userId);
    const next = stepVolume(cur, dir);
    if (next === cur) return;
    const updated = new Map(volumesRef.current).set(userId, next);
    volumesRef.current = updated;
    setVolumes(updated);
    void persistVolume(userId, next);
    const r = remotes.find((x) => x.userId === userId);
    if (r) applyVolume(r.stream, next); // не ждём ре-рендера — слышно сразу
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
      // Включил камеру — телефон держат перед собой: сами уводим звук на
      // громкую связь, если человек не выбирал маршрут руками в этом звонке.
      if (!speakerTouchedRef.current && !speakerOn) {
        setSpeakerOn(true);
        forceSpeaker(true);
      }
      // Датчик приближения гасит экран, когда маршрут — разговорный
      // динамик. В видеозвонке телефон держат перед собой, и экран гас бы
      // от собственной руки, если человек сам выбрал разговорный.
      try {
        InCallManager.stopProximitySensor();
      } catch {
        // веб-стаб
      }
    } else {
      webrtcService.disableCamera();
      setVideoOff(true);
      sendVideoStatus(true);
    }
  };
  // Фронталка ↔ задняя (кнопка видна только при включённой камере).
  const flipCamera = async () => {
    await webrtcService.switchCamera();
    setFacing(webrtcService.getFacing());
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
      {/* Мини-бар свёрнутого звонка живёт В ПОТОКЕ (не оверлеем): он
          сдвигает приложение вниз, и шапки экранов (назад/поиск/звонок)
          остаются кликабельными — оверлей их накрывал наглухо. */}
      <View style={{ flex: 1 }}>
        {inCall && minimized && (
          <Pressable
            onPress={() => setMinimized(false)}
            style={{ paddingTop: insets.top, backgroundColor: theme.colors.online }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, gap: 10 }}>
              <PhoneIcon color="#0a0a0a" size={16} />
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: "#0a0a0a" }}
              >
                {callName} · {remotes.length === 0 ? "звоним…" : fmtDur(callSec)} — вернуться
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
        <View style={{ flex: 1 }}>{children}</View>
      </View>

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
          {/* Remote — full screen for 1:1, grid for groups; сверху — чужой
              экран, если кто-то шарит с компа (тап = развернуть/свернуть) */}
          {remoteTiles.length === 0 && screens.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 16, color: theme.colors.inkDim }}>
                {theme.decorate ? `// звоним · ${callName}` : `Звоним · ${callName}`}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              {screens.length > 0 && (
                <ScreenTiles
                  screens={screens}
                  names={peerInfo}
                  focus={screenFocus}
                  onToggleFocus={() => setScreenFocus((v) => !v)}
                  style={{ flex: screenFocus || remoteTiles.length === 0 ? 1 : 1.35 }}
                />
              )}
              {remoteTiles.length > 0 && (
                // Плитки участников НЕ размонтируем при развороте экрана: в
                // вебе через их RTCView играет звук — пропали бы голоса.
                <View style={screens.length > 0 && screenFocus ? { height: 104 } : { flex: 1 }}>
                  <RemoteGrid
                    tiles={remoteTiles}
                    fallbackName={callName}
                    volumes={volumes}
                    onVolume={changeVolume}
                    openFor={volOpenFor}
                    onToggleOpen={(uid) => setVolOpenFor((cur) => (cur === uid ? null : uid))}
                  />
                </View>
              )}
            </View>
          )}

          {/* Local PiP (draggable) */}
          <LocalPip
            stream={localStream}
            videoOff={videoOff}
            mirror={facing === "user"}
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
          {/* gap поджат и разрешён перенос: с кнопкой динамика их до пяти,
              на узком экране в один ряд по 20px уже не помещались */}
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 44, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
            <CircleBtn bg={muted ? theme.colors.danger : "rgba(255,255,255,0.16)"} onPress={toggleMute}>
              {muted ? <MicOffIcon color="#fff" size={24} /> : <MicIcon color="#fff" size={24} />}
            </CircleBtn>
            {/* Динамик ↔ разговорный. В вебе маршрутом звука рулит система —
                кнопке там нечего делать. */}
            {Platform.OS !== "web" && (
              <CircleBtn bg={speakerOn ? theme.colors.online : "rgba(255,255,255,0.16)"} onPress={toggleSpeaker}>
                <Text style={{ fontSize: 22 }}>{speakerOn ? "🔊" : "🔈"}</Text>
              </CircleBtn>
            )}
            <CircleBtn bg={videoOff ? theme.colors.danger : "rgba(255,255,255,0.16)"} onPress={toggleVideo}>
              {videoOff ? <VideoOffIcon color="#fff" size={24} /> : <VideoIcon color="#fff" size={24} />}
            </CircleBtn>
            {!videoOff && (
              <CircleBtn bg="rgba(255,255,255,0.16)" onPress={flipCamera}>
                <Text style={{ fontSize: 22 }}>🔄</Text>
              </CircleBtn>
            )}
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
          {screens.map((s) => (
            <RTCView key={`scr-${s.userId}`} streamURL={s.stream.toURL()} style={{ width: 1, height: 1 }} />
          ))}
        </View>
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
function RemoteGrid({
  tiles,
  fallbackName,
  volumes,
  onVolume,
  openFor,
  onToggleOpen,
}: {
  tiles: RemoteTileData[];
  fallbackName: string;
  volumes: Map<number, number>;
  onVolume: (userId: number, dir: 1 | -1) => void;
  openFor: number | null;
  onToggleOpen: (userId: number) => void;
}) {
  return (
    <View style={{ ...StyleSheet.absoluteFillObject, flexDirection: "row", flexWrap: "wrap" }}>
      {tiles.map((t, i) => (
        <View key={t.userId} style={[{ padding: tiles.length > 1 ? 1 : 0 }, tileSize(tiles.length, i)]}>
          <RemoteTile
            tile={t}
            fallbackName={fallbackName}
            gain={volumes.get(t.userId) ?? DEFAULT_GAIN}
            onVolume={onVolume}
            open={openFor === t.userId}
            onToggleOpen={onToggleOpen}
          />
        </View>
      ))}
    </View>
  );
}

// Экран(ы), которые шарят с десктопа. objectFit=contain — на экране текст,
// обрезать края нельзя. key по видеодорожке — та же грабля, что у RemoteTile:
// нативный RTCView привязывает дорожку один раз.
function ScreenTiles({
  screens,
  names,
  focus,
  onToggleFocus,
  style,
}: {
  screens: Remote[];
  names: Map<number, PeerInfo>;
  focus: boolean;
  onToggleFocus: () => void;
  style: ViewStyle;
}) {
  const theme = useTheme();
  return (
    <View style={[{ backgroundColor: "#000" }, style]}>
      {screens.map((s) => (
        <Pressable key={s.userId} onPress={onToggleFocus} style={{ flex: 1, overflow: "hidden" }}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <RTCView
              key={s.stream.getVideoTracks()[0]?.id ?? "screen"}
              streamURL={s.stream.toURL()}
              objectFit="contain"
              style={StyleSheet.absoluteFill}
            />
          </View>
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 10,
              bottom: 8,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: "rgba(0,0,0,0.55)",
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: theme.radius.sm,
            }}
          >
            <ScreenIcon color="#fff" size={13} />
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: "#fff" }}>
              {names.get(s.userId)?.username ?? "…"} · экран
            </Text>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
              {focus ? "тап — свернуть" : "тап — развернуть"}
            </Text>
          </View>
        </Pressable>
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

function RemoteTile({
  tile,
  fallbackName,
  gain,
  onVolume,
  open,
  onToggleOpen,
}: {
  tile: RemoteTileData;
  fallbackName: string;
  gain: number;
  onVolume: (userId: number, dir: 1 | -1) => void;
  open: boolean;
  onToggleOpen: (userId: number) => void;
}) {
  const theme = useTheme();
  const { stream, info, videoOff, userId } = tile;
  const name = info?.username ?? fallbackName;
  const showVideo = !videoOff && stream.getVideoTracks().length > 0;
  // Регулятор — только там, где он реально работает. В вебе у дорожки нет
  // _setVolume, и «🔇 Вася» врал бы: Васю прекрасно слышно.
  const volumeSupported = Platform.OS !== "web";
  const showVol = open && volumeSupported;
  // Тап по участнику разворачивает его регулятор громкости прямо в подписи.
  // Отдельную панель сюда не поставить: сверху шапка звонка и «свернуть»,
  // снизу по центру — кнопки управления, а подпись живёт в свободном углу.
  return (
    <Pressable
      onPress={volumeSupported ? () => onToggleOpen(userId) : undefined}
      style={{ flex: 1, backgroundColor: "#111", overflow: "hidden" }}
    >
      {/* RTCView рендерим ВСЕГДА: в вебе (PWA) это <video>, через который
          играет и ЗВУК. Если рендерить его только при включённой камере,
          собеседник без камеры в PWA был бы НЕМЫМ (главная причина «плохих
          звонков с веб-формы»). При выключенном видео поверх — аватарка.
          key по видеодорожке ОБЯЗАТЕЛЕН: нативный RTCView привязывает
          дорожку один раз при установке streamURL; камера теперь всегда
          приезжает ПОЗЖЕ (аудио-старт), и без ремаунта был бы вечный
          чёрный экран вместо видео.
          pointerEvents="none" на обёртке — как в LocalPip: нативный
          RTCView (SurfaceView) съедает касание, и тап по плитке с
          ВКЛЮЧЁННЫМ видео не открывал бы регулятор громкости. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <RTCView
          key={stream.getVideoTracks()[0]?.id ?? "audio-only"}
          streamURL={stream.toURL()}
          objectFit="cover"
          style={StyleSheet.absoluteFill}
        />
      </View>
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
      {/* Подпись участника, она же регулятор его громкости по тапу.
          Не-стопроцентная громкость видна и в свёрнутом виде — иначе
          «почему он такой тихий» выяснялось бы методом тыка. */}
      <View
        style={{
          position: "absolute",
          left: 6,
          bottom: 6,
          // Раскрытый регулятор ограничиваем шириной плитки: без right он
          // считается по контенту (~96px сверх имени) и уезжал за край в
          // сетке на 4-6 человек — кнопка «+» была недостижима. Закрытая
          // подпись остаётся компактной «по содержимому».
          ...(showVol ? { right: 6 } : null),
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 6,
          paddingVertical: 3,
          backgroundColor: "rgba(0,0,0,0.55)",
          borderRadius: 4,
        }}
      >
        <Text
          style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: "#fff", flexShrink: 1 }}
          numberOfLines={1}
        >
          {!volumeSupported || gain === DEFAULT_GAIN
            ? name
            : gain === 0
              ? `🔇 ${name}`
              : `${name} · ${volumeLabel(gain)}`}
        </Text>
        {showVol && (
          <>
            <VolBtn label="−" onPress={() => onVolume(userId, -1)} />
            <Text
              style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: "#fff", minWidth: 34, textAlign: "center" }}
            >
              {volumeLabel(gain)}
            </Text>
            <VolBtn label="+" onPress={() => onVolume(userId, 1)} />
          </>
        )}
      </View>
    </Pressable>
  );
}

/** Кнопка −/+ в подписи участника. Мелкая по площади, но с hitSlop:
 *  пальцем по плитке 1/6 экрана иначе не попасть. */
function VolBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: "rgba(255,255,255,0.2)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontSize: 14, lineHeight: 16, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function LocalPip({
  stream,
  videoOff,
  mirror,
  meLetter,
  meAvatar,
  meColor,
}: {
  stream: MediaStream | null;
  videoOff: boolean;
  mirror: boolean;
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
          <RTCView
            key={stream.getVideoTracks()[0]?.id ?? "self"}
            streamURL={stream.toURL()}
            objectFit="cover"
            mirror={mirror}
            style={{ flex: 1 }}
            // В вебе RTCView — это <video>: своё превью ВСЕГДА без звука,
            // независимо от зеркала (иначе задняя камера = эхо микрофона).
            {...({ muted: true } as Record<string, unknown>)}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Avatar letter={meLetter} size={56} bg={meColor} uri={meAvatar} />
          </View>
        )}
      </View>
    </Animated.View>
  );
}
