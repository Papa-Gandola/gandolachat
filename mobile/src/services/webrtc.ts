import { PermissionsAndroid, Platform } from "react-native";
import {
  MediaStream,
  mediaDevices,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from "react-native-webrtc";

import { wsService } from "./ws";

// react-native-webrtc's getUserMedia fails on Android unless the runtime
// permissions are granted first (the manifest entries alone aren't enough).
async function ensurePermissions(video: boolean) {
  if (Platform.OS !== "android") return;
  const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (video) perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  // BLUETOOTH_CONNECT (Android 12+) — БЕЗ него InCallManager вообще не
  // видит гарнитуру: его BT-менеджер на старте проверяет разрешение и молча
  // выходит, BT не попадает в список устройств, и звук звонка уходит мимо
  // наушников. Спрашиваем здесь, вместе с микрофоном на первом звонке:
  // в середине разговора диалог «разрешить доступ к устройствам рядом»
  // выглядит дико. Отказ звонок не ломает — просто не будет BT-маршрута.
  if (typeof Platform.Version === "number" && Platform.Version >= 31) {
    perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  }
  try {
    await PermissionsAndroid.requestMultiple(perms);
  } catch {
    // ignore — getUserMedia will surface the failure
  }
}

// Масштаб захвата экрана телефона (см. startScreenShare).
const SCREEN_SCALE = 0.6;

// Mirror the desktop ICE config so calls traverse the same STUN/TURN servers.
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "turn:2.26.117.77:3478", username: "gandola", credential: "gandolapass" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  ],
};

type StreamCb = (userId: number, stream: MediaStream) => void;
type LeftCb = (userId: number) => void;
type EndedCb = () => void;

// WebRTC for mobile. The desktop client uses simple-peer; the server just relays
// opaque `signal` blobs over the `call_signal` WS event. To interop with desktop
// we speak simple-peer's wire dialect from a raw RTCPeerConnection:
//   - SDP:  send/accept { type: 'offer'|'answer', sdp }   (simple-peer reads data.sdp)
//   - ICE:  send { type: 'candidate', candidate: {candidate, sdpMLineIndex, sdpMid} }
//           accept anything with data.candidate
// v1 targets 1:1 (DM) calls; group mesh is a follow-up.
class WebRTCService {
  private myId: number | null = null;
  private chatId: number | null = null;
  private localStream: MediaStream | null = null;
  private peers = new Map<number, RTCPeerConnection>();
  // Signals that arrive before we've acquired a local stream (i.e. before the
  // user accepts) are queued per remote user and flushed on joinCall().
  // У записи — chat_id: по концу звонка (пустой call_active) и по
  // «Отклонить» хвосты ЭТОГО чата выкидываются (discardPending), а флаш
  // применяет только сигналы чата, в который входим — иначе протухший
  // оффер отклонённого звонка отвечался при позднем «Присоединиться» в
  // никуда и блокировал tie-break, а чужой чат получал фантомный peer.
  private pending = new Map<number, { chatId: number; signal: unknown }[]>();
  // ICE candidates that arrived before setRemoteDescription completed for that
  // peer. Held here until the SDP lands, then drained.
  private earlyCandidates = new Map<number, unknown[]>();
  // Канонический MediaStream на каждого собеседника: дорожки, приходящие без
  // привязки к потоку (десктопный transceiver без msid), докладываем сюда.
  private remoteStreams = new Map<number, MediaStream>();
  // RTCRtpSender видеодорожки на каждого peer'а — для replaceTrack при
  // выключении/включении камеры без полной ренегосиации.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private videoSenders = new Map<number, any>();

  // Какая камера сейчас: фронталка (user) или задняя (environment).
  private facing: "user" | "environment" = "user";

  // --- Живучесть соединений -------------------------------------------------
  // Кто офферил соединение — тот и делает ICE-restart (как у simple-peer на
  // десктопе: restartIce зовёт только инициатор, респондер ждёт новый оффер).
  private initiators = new Map<number, boolean>();
  // Дебаунс «disconnected» (2с — ICE часто сам возвращается) и сторож
  // «failed» (20/30с — если никто не восстановил, пересобираем соединение).
  private restartTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private failTimers = new Map<number, ReturnType<typeof setTimeout>>();
  // Висяк прозвона: наш оффер, на который так и не пришёл ансвер (та сторона
  // была оффлайн / перезапустила приложение и вошла через call_join) — через
  // 5с после call_active с ней пересобираем соединение по tie-break'у.
  private staleTimers = new Map<number, ReturnType<typeof setTimeout>>();
  // Сигналы, не ушедшие из-за закрытого сокета (сеть моргнула): без очереди
  // оффер/кандидаты терялись, и соединение висло навсегда. Доотправляем на
  // _ws_open, потом просим ICE перепроверить пути.
  private outbox: Array<Record<string, unknown>> = [];
  // Сигналы применяем строго по очереди на каждого peer'а: setRemoteDescription
  // асинхронный, и кандидат, прилетевший следом за новым оффером, иначе мог
  // примениться к СТАРОМУ описанию (после ICE-restart — «unknown ufrag»).
  private chains = new Map<number, Promise<void>>();

  // --- Приём экрана с десктопа --------------------------------------------
  // Десктоп шарит экран ОТДЕЛЬНЫМ simple-peer'ом на каждого (purpose=screen,
  // сам — инициатор, role=sender). Мы только принимаем: свой RTCPeerConnection
  // на каждого шарящего, ответы уходят с role=receiver — так десктоп
  // маршрутизирует их в свой отправляющий peer. Сами экран не шарим
  // (нужен MediaProjection — нативная работа, см. CLAUDE.md).
  private screenPeers = new Map<number, RTCPeerConnection>();
  private screenEarly = new Map<number, unknown[]>();
  private pendingScreen = new Map<number, { chatId: number; signal: unknown }[]>();
  private screenStreams = new Map<number, MediaStream>();

  // --- Шаринг СВОЕГО экрана (с телефона / из браузера) ---------------------
  // Зеркало десктопного startScreenShare: отдельное соединение на КАЖДОГО
  // участника (purpose=screen, role=sender; мы — инициатор), ответы приходят
  // с role=receiver и маршрутизируются сюда, а не в приёмные screenPeers, —
  // так один и тот же собеседник может одновременно и показывать нам экран,
  // и смотреть наш. Натив: getDisplayMedia react-native-webrtc
  // (MediaProjection; foreground-сервис библиотеки включает
  // plugins/withWebRTCMediaProjection — без него Android 14+ бросает
  // SecurityException). PWA: браузерный getDisplayMedia — есть только в
  // десктопных браузерах, на телефонах кнопка скрыта (canShareScreen).
  private localScreenStream: MediaStream | null = null;
  private screenSendPeers = new Map<number, RTCPeerConnection>();
  private screenSendEarly = new Map<number, unknown[]>();
  private screenSendRestart = new Map<number, ReturnType<typeof setTimeout>>();

  onStream: StreamCb | null = null;
  onPeerLeft: LeftCb | null = null;
  onCallEnded: EndedCb | null = null;
  onScreenStream: StreamCb | null = null;
  onScreenEnded: LeftCb | null = null;
  /** Наш шаринг остановила система/браузер (шторка «Остановить», «Stop
   *  sharing») или кончился звонок — UI гасит кнопку. */
  onScreenShareEnded: EndedCb | null = null;

  getFacing() {
    return this.facing;
  }

  init(myId: number) {
    this.myId = myId;
    // wsService.disconnect() (логаут) стирает ВСЕ хендлеры разом. Поэтому
    // перевешиваем свои при каждом init (off → on = идемпотентно) — иначе
    // после перелогина в том же процессе входящие звонки мертвы.
    wsService.off("call_signal", this._onSignal);
    wsService.off("call_end", this._onEnd);
    wsService.off("call_active", this._onCallActive);
    wsService.off("screen_share_status", this._onScreenStatus);
    wsService.off("_ws_open", this._onWsOpen);
    wsService.on("call_signal", this._onSignal);
    wsService.on("call_end", this._onEnd);
    // Group calls: the server broadcasts the full participant list on each
    // call_signal. We use it to ensure every pair of participants is
    // connected (mesh) — a brand-new joiner sees everyone, and existing
    // members open a connection to them.
    wsService.on("call_active", this._onCallActive);
    // Десктоп объявляет старт/стоп шаринга — по «стоп» гасим плитку экрана
    // сразу, не дожидаясь, пока соединение развалится само.
    wsService.on("screen_share_status", this._onScreenStatus);
    wsService.on("_ws_open", this._onWsOpen);
  }

  isInCall() {
    return this.localStream !== null;
  }
  getLocalStream() {
    return this.localStream;
  }
  getChatId() {
    return this.chatId;
  }

  async startCall(chatId: number, targetIds: number[], video: boolean): Promise<MediaStream> {
    this.chatId = chatId;
    this.localStream = await this._getMedia(video);
    for (const uid of targetIds) {
      if (uid !== this.myId) this._createPeer(uid, true);
    }
    return this.localStream;
  }

  async joinCall(chatId: number, initiatorId: number, video: boolean): Promise<MediaStream> {
    this.chatId = chatId;
    this.localStream = await this._getMedia(video);
    if (!this.peers.has(initiatorId)) this._createPeer(initiatorId, false);
    await this._flushPending();
    return this.localStream;
  }

  // Flush every queued signal now that we have a peer + local media.
  // Order matters: SDP (offer/answer) MUST land before any ICE candidate,
  // otherwise addIceCandidate throws because remoteDescription is null and
  // the candidate is lost — ICE never completes and the call sticks on
  // "waiting for participant". Sort SDP-first and await each apply to keep
  // them strictly sequential.
  private async _flushPending() {
    const bySdpFirst = (a: unknown, b: unknown) => {
      const aSdp = (a as { sdp?: string } | null)?.sdp ? 0 : 1;
      const bSdp = (b as { sdp?: string } | null)?.sdp ? 0 : 1;
      return aSdp - bSdp;
    };
    for (const [uid, entries] of Array.from(this.pending.entries())) {
      // Только сигналы ТОГО чата, в который входим (звонок в ЛС, пока мы
      // входили в групповой созвон, — не наш peer).
      const sigs = entries.filter((e) => e.chatId === this.chatId).map((e) => e.signal);
      // Хвост без оффера (кандидаты соединения, оффер которого мы не видели)
      // бесполезен, а responder-peer под него блокировал бы tie-break в
      // _onCallActive («peer уже есть» — и никто не офферит).
      if (!sigs.some((s) => (s as { type?: string } | null)?.type === "offer")) continue;
      if (!this.peers.has(uid)) this._createPeer(uid, false);
      for (const s of [...sigs].sort(bySdpFirst)) await this._enqueue(uid, s);
    }
    this.pending.clear();
    // Экран, который начали шарить, пока мы ещё «звонили» (не приняли)
    for (const [uid, entries] of Array.from(this.pendingScreen.entries())) {
      const sigs = entries.filter((e) => e.chatId === this.chatId).map((e) => e.signal);
      for (const s of [...sigs].sort(bySdpFirst)) await this._applyScreenSignal(uid, s);
    }
    this.pendingScreen.clear();
  }

  /** Лежит ли в очереди НЕОТВЕЧЕННЫЙ оффер от этого собеседника по этому
   *  чату. По нему решаем, как принимать входящий: обычным ответом
   *  (joinCall) или входом в идущий звонок (joinOngoing) — когда телефон
   *  спал и оффер до него не долетел, отвечать нечему. */
  hasPendingOffer(chatId: number, fromUserId: number): boolean {
    const entries = this.pending.get(fromUserId) ?? [];
    return entries.some(
      (e) => e.chatId === chatId && (e.signal as { type?: string } | null)?.type === "offer",
    );
  }

  /** Выкинуть сигналы, накопленные до входа (чата или все): после
   *  «Отклонить» и по концу звонка оффер звонившего протух — та сторона
   *  снесла свой peer к нам, ответ ушёл бы в никуда. */
  discardPending(chatId?: number) {
    const prune = (map: Map<number, { chatId: number; signal: unknown }[]>) => {
      if (chatId == null) {
        map.clear();
        return;
      }
      for (const [uid, entries] of Array.from(map.entries())) {
        const rest = entries.filter((e) => e.chatId !== chatId);
        if (rest.length) map.set(uid, rest);
        else map.delete(uid);
      }
    };
    prune(this.pending);
    prune(this.pendingScreen);
  }

  /** Присоединение к УЖЕ идущему звонку (плашка «в созвоне» / кнопка при
   *  живом созвоне). Серверу шлём call_join — он рассылает call_active, и
   *  mesh дособирается сам обычным tie-break'ом в _onCallActive.
   *  КРИТИЧНО: сначала применяем накопленные сигналы — если звонящий уже
   *  слал нам оффер (мы «прозвонили» 20с и вошли позже), отвечаем ИМЕННО
   *  ему, иначе его соединение навсегда зависло бы в have-local-offer. */
  async joinOngoing(chatId: number): Promise<MediaStream> {
    this.chatId = chatId;
    this.localStream = await this._getMedia(false);
    await this._flushPending();
    // Через очередь: вход из пуша случается сразу после пробуждения
    // телефона, когда сокет ещё переподключается — прямой send потерял бы
    // call_join, и сторожок через 12с убил бы звонок «Звоним…».
    this._emit({ type: "call_join", chat_id: chatId });
    return this.localStream;
  }

  private async _getMedia(video: boolean): Promise<MediaStream> {
    await ensurePermissions(video);
    try {
      return await mediaDevices.getUserMedia({ audio: true, video });
    } catch {
      return await mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }

  private _createPeer(uid: number, initiator: boolean): RTCPeerConnection {
    const existing = this.peers.get(uid);
    if (existing) {
      try {
        existing.close();
      } catch {
        // ignore
      }
      this.peers.delete(uid);
    }
    this._clearTimers(uid);
    const pc = new RTCPeerConnection(ICE_CONFIG);
    this.peers.set(uid, pc);
    this.initiators.set(uid, initiator);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream);
        if (track.kind === "video") this.videoSenders.set(uid, sender);
      }
      // Камера выключена (обычный старт звонка) — всё равно СРАЗУ заводим
      // видео-линию, как это делает десктоп. Без неё в согласованном SDP
      // видео нет вообще, и включённая позже камера ЛЮБОЙ из сторон
      // требует ренегосиации, которую отвечающая сторона начать не может
      // (m-line добавляет только офферящий): «позвонил с компа без видео,
      // телефон вошёл, включил видео на компе — ничего не видно».
      // sendrecv без дорожки ничего не шлёт, но слот согласован: дальше
      // хватает replaceTrack в любую сторону.
      if (!this.localStream.getVideoTracks().length) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tr = (pc as any).addTransceiver("video", { direction: "sendrecv" });
          if (tr?.sender) this.videoSenders.set(uid, tr.sender);
        } catch (err) {
          console.warn("[webrtc] addTransceiver(video) failed", err);
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc.addEventListener("icecandidate", (e: any) => {
      const c = e.candidate;
      if (c) {
        this._send(uid, {
          type: "candidate",
          candidate: { candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex, sdpMid: c.sdpMid },
        });
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc.addEventListener("track", (e: any) => {
      // Дорожка может прийти БЕЗ привязки к потоку (десктоп добавляет видео-
      // transceiver без msid, когда стартует с выключенной камерой). Раньше
      // такие выбрасывались — из-за этого включённая позже вебка с компа не
      // появлялась на телефоне. Держим свой поток на собеседника и докладываем
      // осиротевшие дорожки в него.
      let stream: MediaStream | undefined = e.streams && e.streams[0];
      if (stream) {
        this.remoteStreams.set(uid, stream);
      } else {
        stream = this.remoteStreams.get(uid);
        if (!stream) {
          stream = new MediaStream(undefined as unknown as MediaStream);
          this.remoteStreams.set(uid, stream);
        }
        try {
          stream.addTrack(e.track);
        } catch {
          // дубликат дорожки — не страшно
        }
      }
      this.onStream?.(uid, stream);
    });
    // Ренегосиация: стреляет, когда дорожку добавили ПОСРЕДИ звонка (включили
    // камеру). Шлём свежий оффер, но только когда первичный обмен уже прошёл —
    // иначе на старте улетел бы двойной оффер (ручной + этот).
    pc.addEventListener("negotiationneeded", () => {
      void this._renegotiate(uid, pc);
    });
    // Живучесть. Раньше «failed» = участник выкинут навсегда: смена сети
    // (Wi-Fi ↔ LTE, VPN) на любой стороне убивала звонок. Теперь:
    //   disconnected → через 2с (ICE часто оживает сам) инициатор шлёт
    //                  оффер с iceRestart, респондер ждёт чужой;
    //   failed       → инициатор рестартит сразу; сторож 20с (инициатор)
    //                  / 30с (респондер — чтобы не офферить одновременно)
    //                  пересобирает соединение свежим оффером, если так и не
    //                  ожило. Десктопный simple-peer на failed сам себя
    //                  уничтожает и пару не восстанавливает — наш свежий
    //                  оффер он примет как новый respondер (createIfMissing);
    //   closed       → соединение закрыто явно, участник ушёл.
    pc.addEventListener("iceconnectionstatechange", () => {
      const st = pc.iceConnectionState as string;
      if (st === "connected" || st === "completed") {
        this._clearTimers(uid);
        return;
      }
      if (st === "disconnected") this._scheduleRestart(uid, pc, 2000, "ice=disconnected");
      if (st === "failed") {
        this._scheduleRestart(uid, pc, 0, "ice=failed");
        this._armFailWatch(uid, pc);
      }
    });
    pc.addEventListener("connectionstatechange", () => {
      const st = (pc as unknown as { connectionState?: string }).connectionState;
      if (st === "connected") {
        this._clearTimers(uid);
      } else if (st === "failed") {
        this._scheduleRestart(uid, pc, 0, "pc=failed");
        this._armFailWatch(uid, pc);
      } else if (st === "closed") {
        if (this.peers.get(uid) === pc) this._dropPeer(uid);
      }
    });

    if (initiator) {
      (async () => {
        try {
          const offer = await pc.createOffer({});
          await pc.setLocalDescription(offer);
          this._send(uid, { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp });
        } catch (err) {
          console.warn("[webrtc] createOffer failed", err);
        }
      })();
    }
    // Уже шарим экран, а это новый (или пересобранный после обрыва)
    // участник — открываем ему и экранное соединение, иначе опоздавший в
    // созвон экрана не увидит до стоп/старт шаринга (как на десктопе).
    if (this.localScreenStream) this._createScreenSendPeer(uid);
    return pc;
  }

  /** Свежий оффер существующему соединению — только когда первичный обмен
   *  уже прошёл и состояние стабильно (иначе глейр/двойной оффер). */
  private async _renegotiate(uid: number, pc: RTCPeerConnection) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = pc as any;
    if (!p.remoteDescription || p.signalingState !== "stable") return;
    try {
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      this._send(uid, { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp });
    } catch (err) {
      console.warn("[webrtc] renegotiate failed", err);
    }
  }

  private _send(uid: number, signal: unknown) {
    this._emit({
      type: "call_signal",
      chat_id: this.chatId,
      target_user_id: uid,
      signal,
      purpose: "webcam",
    });
  }

  /** Сигнал экранного соединения. role говорит той стороне, КАКОЙ из её
   *  двух экранных peer'ов к нам адресат: receiver — мы принимаем её экран
   *  (ответ уйдёт в её отправляющий peer), sender — мы шарим свой. */
  private _sendScreen(uid: number, signal: unknown, role: "receiver" | "sender" = "receiver") {
    this._emit({
      type: "call_signal",
      chat_id: this.chatId,
      target_user_id: uid,
      signal,
      purpose: "screen",
      role,
    });
  }

  /** Отправка с очередью: сокет закрыт (сеть моргнула) — сигнал ждёт
   *  реконнекта, а не пропадает. Очередь конечная: старее полусотни
   *  сообщений всё равно уже неактуально. */
  private _emit(msg: Record<string, unknown>) {
    if (wsService.send(msg)) return;
    this.outbox.push(msg);
    if (this.outbox.length > 60) this.outbox.splice(0, this.outbox.length - 60);
  }

  private _onWsOpen = () => {
    if (!this.localStream) {
      this.outbox = [];
      return;
    }
    const queued = this.outbox;
    this.outbox = [];
    for (const msg of queued) wsService.send(msg);
    // После обрыва сети адреса могли смениться — пусть ICE перепроверит пути
    this.recover("ws-open");
  };

  /** Проверить все соединения и восстановить упавшие (реконнект сокета,
   *  возврат приложения из фона). Безопасно звать сколько угодно. */
  recover(reason: string) {
    for (const [uid, pc] of this.peers) {
      const st = pc.iceConnectionState as string;
      if (st === "disconnected" || st === "failed") this._scheduleRestart(uid, pc, 0, reason);
    }
    for (const [uid, pc] of this.screenSendPeers) {
      const st = pc.iceConnectionState as string;
      if (st === "disconnected" || st === "failed") this._scheduleScreenRestart(uid, pc, 0);
    }
  }

  private _clearTimers(uid: number) {
    const r = this.restartTimers.get(uid);
    if (r) clearTimeout(r);
    this.restartTimers.delete(uid);
    const f = this.failTimers.get(uid);
    if (f) clearTimeout(f);
    this.failTimers.delete(uid);
    const s = this.staleTimers.get(uid);
    if (s) clearTimeout(s);
    this.staleTimers.delete(uid);
  }

  private _scheduleRestart(uid: number, pc: RTCPeerConnection, delay: number, reason: string) {
    if (this.restartTimers.has(uid)) return;
    this.restartTimers.set(
      uid,
      setTimeout(() => {
        this.restartTimers.delete(uid);
        if (this.peers.get(uid) !== pc) return;
        const st = pc.iceConnectionState as string;
        if (st !== "disconnected" && st !== "failed") return; // само ожило
        void this._restartIce(uid, pc, reason);
      }, delay),
    );
  }

  /** ICE-restart: свежий оффер с новыми ufrag/pwd (только инициатор).
   *  Если наш прошлый оффер так и висит без ответа (have-local-offer —
   *  ответ потерялся в обрыве сети), просто шлём его ещё раз. */
  private async _restartIce(uid: number, pc: RTCPeerConnection, reason: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = pc as any;
    if (p.signalingState === "have-local-offer" && pc.localDescription) {
      console.log(`[webrtc] resend offer to ${uid} (${reason})`);
      this._send(uid, { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
      return;
    }
    if (!this.initiators.get(uid)) return; // респондер ждёт оффер инициатора
    if (p.signalingState !== "stable") return;
    try {
      console.log(`[webrtc] ICE restart → ${uid} (${reason})`);
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this._send(uid, { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp });
    } catch (err) {
      console.warn("[webrtc] ICE restart failed", err);
    }
  }

  /** Сторож на «failed»: инициатор ждёт 20с, респондер 30с (чтобы не
   *  офферить навстречу). Не ожило — пересобираем соединение с нуля свежим
   *  оффером, уже В ЛЮБОЙ роли: другой стороне это обычный входящий оффер. */
  private _armFailWatch(uid: number, pc: RTCPeerConnection) {
    if (this.failTimers.has(uid)) return;
    const delay = this.initiators.get(uid) ? 20000 : 30000;
    this.failTimers.set(
      uid,
      setTimeout(() => {
        this.failTimers.delete(uid);
        if (this.peers.get(uid) !== pc || !this.localStream) return;
        const st = pc.iceConnectionState as string;
        if (st === "connected" || st === "completed") return;
        console.log(`[webrtc] peer ${uid} dead for too long — rebuilding`);
        this._createPeer(uid, true);
      }, delay),
    );
  }

  private _dropPeer(uid: number) {
    this._clearTimers(uid);
    const pc = this.peers.get(uid);
    if (pc) {
      try {
        pc.close();
      } catch {
        // ignore
      }
    }
    this.peers.delete(uid);
    this.initiators.delete(uid);
    this.chains.delete(uid);
    this.remoteStreams.delete(uid);
    this.videoSenders.delete(uid);
    this.earlyCandidates.delete(uid);
    this._dropScreenSend(uid);
    this.onPeerLeft?.(uid);
    // localStream уже null = teardown идёт прямо сейчас, второй не нужен
    if (this.peers.size === 0 && this.localStream) this._teardown();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _onSignal = (data: any) => {
    const fromId = data.from_user_id as number;
    if (data.purpose === "screen") {
      this._onScreenSignal(fromId, data);
      return;
    }
    const signal = data.signal;
    if (!this.localStream) {
      // Not in a call yet (incoming, awaiting accept) — queue.
      const q = this.pending.get(fromId) ?? [];
      q.push({ chatId: Number(data.chat_id), signal });
      this.pending.set(fromId, q);
      return;
    }
    const existing = this.peers.get(fromId);
    if (!existing && signal?.type !== "offer") {
      // Ансвер/кандидат без peer'а — хвост соединения, которого у нас уже
      // нет. Peer, созданный под ансвер, тут же падал бы на
      // setRemoteDescription, а созданный под кандидаты — блокировал бы
      // tie-break в _onCallActive («peer уже есть»). Свежий оффер той
      // стороны создаст peer как обычно.
      console.log(`[webrtc] ${signal?.type ?? "candidate"} from ${fromId} without a peer — dropped`);
      return;
    }
    // Оффер на МЁРТВОЕ соединение (та сторона пересобрала своё после
    // failed) — отвечаем свежим peer'ом, а не пытаемся оживить труп.
    const dead = existing && (existing.iceConnectionState as string) === "failed";
    if (!existing || (dead && signal?.type === "offer")) this._createPeer(fromId, false);
    void this._enqueue(fromId, signal);
  };

  /** Сигналы одного собеседника — строго по очереди (см. chains). */
  private _enqueue(uid: number, signal: unknown): Promise<void> {
    const prev = this.chains.get(uid) ?? Promise.resolve();
    const next = prev.then(() => this._applySignal(uid, signal)).catch(() => undefined);
    this.chains.set(uid, next);
    return next;
  }

  // --- экран с десктопа -----------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _onScreenSignal(uid: number, data: any) {
    const signal = data.signal;
    if (!signal) return;
    // role=receiver — ответ НАШЕМУ отправляющему peer'у (мы шарим экран).
    // Не шарим — это хвост уже закрытого шаринга, выбрасываем.
    if (data.role === "receiver") {
      if (this.localScreenStream) void this._applyScreenSendSignal(uid, signal);
      return;
    }
    if (!this.localStream) {
      const q = this.pendingScreen.get(uid) ?? [];
      q.push({ chatId: Number(data.chat_id), signal });
      this.pendingScreen.set(uid, q);
      return;
    }
    void this._applyScreenSignal(uid, signal);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _applyScreenSignal(uid: number, signal: any) {
    let pc = this.screenPeers.get(uid);
    if (!pc) {
      // Соединение открывает только оффер; кандидаты раньше него — в очередь
      if (!signal.sdp || signal.type !== "offer") {
        if (signal.candidate) {
          const q = this.screenEarly.get(uid) ?? [];
          q.push(signal);
          this.screenEarly.set(uid, q);
        }
        return;
      }
      pc = this._createScreenPeer(uid);
    }
    try {
      if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
        if (signal.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this._sendScreen(uid, { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp });
        }
        const queued = this.screenEarly.get(uid);
        if (queued && queued.length) {
          this.screenEarly.delete(uid);
          for (const c of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate((c as { candidate: unknown }).candidate as never));
            } catch (err) {
              console.warn("[webrtc] screen: drained candidate failed", err);
            }
          }
        }
      } else if (signal.candidate) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!(pc as any).remoteDescription) {
          const q = this.screenEarly.get(uid) ?? [];
          q.push(signal);
          this.screenEarly.set(uid, q);
          return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.warn("[webrtc] screen signal failed", err);
    }
  }

  private _createScreenPeer(uid: number): RTCPeerConnection {
    // Старое соединение закрываем, но очередь ранних кандидатов НЕ трогаем:
    // они пришли вместе с этим же оффером и нужны новому peer'у
    const old = this.screenPeers.get(uid);
    if (old) {
      try {
        old.close();
      } catch {
        // ignore
      }
      this.screenPeers.delete(uid);
      this.screenStreams.delete(uid);
    }
    const pc = new RTCPeerConnection(ICE_CONFIG);
    this.screenPeers.set(uid, pc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc.addEventListener("icecandidate", (e: any) => {
      const c = e.candidate;
      if (c) {
        this._sendScreen(uid, {
          type: "candidate",
          candidate: { candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex, sdpMid: c.sdpMid },
        });
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc.addEventListener("track", (e: any) => {
      let stream: MediaStream | undefined = e.streams && e.streams[0];
      if (!stream) {
        stream = this.screenStreams.get(uid);
        if (!stream) stream = new MediaStream(undefined as unknown as MediaStream);
        try {
          stream.addTrack(e.track);
        } catch {
          // дубликат
        }
      }
      this.screenStreams.set(uid, stream);
      this.onScreenStream?.(uid, stream);
    });
    // Шарящий (инициатор) сам рестартит ICE на disconnected; нам достаточно
    // не выбрасывать плитку раньше времени — только на failed/closed.
    pc.addEventListener("connectionstatechange", () => {
      const st = (pc as unknown as { connectionState?: string }).connectionState;
      if ((st === "failed" || st === "closed") && this.screenPeers.get(uid) === pc) this._dropScreen(uid, true);
    });
    return pc;
  }

  private _dropScreen(uid: number, notify: boolean) {
    const pc = this.screenPeers.get(uid);
    if (pc) {
      try {
        pc.close();
      } catch {
        // ignore
      }
    }
    const had = this.screenPeers.delete(uid);
    this.screenEarly.delete(uid);
    this.screenStreams.delete(uid);
    if (had && notify) this.onScreenEnded?.(uid);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _onScreenStatus = (data: any) => {
    if (data.sharing) return;
    const uid = data.user_id as number;
    this.pendingScreen.delete(uid);
    this._dropScreen(uid, true);
  };

  // --- свой экран -----------------------------------------------------------

  /** Есть ли чем шарить: натив — Android (MediaProjection через
   *  react-native-webrtc), веб — только браузеры с getDisplayMedia
   *  (десктопные; мобильные Chrome/Safari его не дают). */
  canShareScreen(): boolean {
    if (Platform.OS === "web") {
      return typeof (mediaDevices as unknown as { getDisplayMedia?: unknown })?.getDisplayMedia === "function";
    }
    return Platform.OS === "android";
  }

  isSharingScreen(): boolean {
    return this.localScreenStream !== null;
  }

  /** Начать показ экрана всем участникам текущего звонка. false — отказ
   *  (системный диалог отклонён, натив не дал захват, звонка нет). */
  async startScreenShare(): Promise<boolean> {
    if (!this.localStream || this.chatId == null) return false;
    if (this.localScreenStream) return true;
    let stream: MediaStream;
    try {
      // Натив читает только ветку android (масштаб: полный 1080×2400 на
      // 30 fps в mesh из нескольких кодировщиков — перебор для телефона;
      // текст при 0.6 на мониторе всё ещё читается). Браузеру — video:true.
      const constraints: unknown =
        Platform.OS === "web"
          ? { video: true, audio: false }
          : { video: true, android: { resolutionScale: SCREEN_SCALE } };
      stream = await (mediaDevices as unknown as {
        getDisplayMedia: (c: unknown) => Promise<MediaStream>;
      }).getDisplayMedia(constraints);
    } catch (err) {
      console.warn("[webrtc] getDisplayMedia failed", err);
      return false;
    }
    // Пока спрашивали разрешение, звонок мог кончиться
    if (!this.localStream || this.chatId == null) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    this.localScreenStream = stream;
    // Стоп из системного UI (шторка «Остановить», кнопка Chrome «Stop
    // sharing»): дорожка кончается сама — сворачиваем шаринг и говорим UI.
    const track = stream.getVideoTracks()[0];
    if (track) {
      const onEnded = () => {
        if (this.localScreenStream !== stream) return;
        this.stopScreenShare();
        this.onScreenShareEnded?.();
      };
      try {
        track.addEventListener("ended", onEnded);
      } catch {
        (track as unknown as { onended: (() => void) | null }).onended = onEnded;
      }
    }
    for (const uid of Array.from(this.peers.keys())) this._createScreenSendPeer(uid);
    this._emit({ type: "screen_share_status", chat_id: this.chatId, sharing: true });
    return true;
  }

  /** Остановить показ своего экрана (приёмные экраны других не трогаем). */
  stopScreenShare(notify = true) {
    const ls = this.localScreenStream;
    if (!ls) return;
    this.localScreenStream = null;
    for (const uid of Array.from(this.screenSendPeers.keys())) this._dropScreenSend(uid);
    this.screenSendEarly.clear();
    ls.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        // уже остановлена
      }
    });
    // Той стороне — «стоп» явно: плитка гаснет сразу, а не когда соединение
    // развалится по таймауту (так же делает десктоп).
    if (notify && this.chatId != null) {
      this._emit({ type: "screen_share_status", chat_id: this.chatId, sharing: false });
    }
  }

  private _createScreenSendPeer(uid: number) {
    const ls = this.localScreenStream;
    if (!ls) return;
    this._dropScreenSend(uid);
    const pc = new RTCPeerConnection(ICE_CONFIG);
    this.screenSendPeers.set(uid, pc);
    for (const track of ls.getTracks()) pc.addTrack(track, ls);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc.addEventListener("icecandidate", (e: any) => {
      const c = e.candidate;
      if (c) {
        this._sendScreen(
          uid,
          { type: "candidate", candidate: { candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex, sdpMid: c.sdpMid } },
          "sender",
        );
      }
    });
    // Мы инициатор — мы и рестартим ICE (респондер-приёмник ждёт наш оффер).
    pc.addEventListener("iceconnectionstatechange", () => {
      const st = pc.iceConnectionState as string;
      if (st === "connected" || st === "completed") {
        const t = this.screenSendRestart.get(uid);
        if (t) clearTimeout(t);
        this.screenSendRestart.delete(uid);
        return;
      }
      if (st === "disconnected") this._scheduleScreenRestart(uid, pc, 2000);
      if (st === "failed") this._scheduleScreenRestart(uid, pc, 0);
    });
    void this._offerScreen(uid, pc, false);
  }

  private async _offerScreen(uid: number, pc: RTCPeerConnection, iceRestart: boolean) {
    try {
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : {});
      await pc.setLocalDescription(offer);
      this._sendScreen(uid, { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp }, "sender");
    } catch (err) {
      console.warn("[webrtc] screen offer failed", err);
    }
  }

  private _scheduleScreenRestart(uid: number, pc: RTCPeerConnection, delay: number) {
    if (this.screenSendRestart.has(uid)) return;
    this.screenSendRestart.set(
      uid,
      setTimeout(() => {
        this.screenSendRestart.delete(uid);
        if (this.screenSendPeers.get(uid) !== pc) return;
        const st = pc.iceConnectionState as string;
        if (st !== "disconnected" && st !== "failed") return; // само ожило
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((pc as any).signalingState !== "stable") return;
        console.log(`[webrtc] screen ICE restart → ${uid} (${st})`);
        void this._offerScreen(uid, pc, true);
      }, delay),
    );
  }

  private _dropScreenSend(uid: number) {
    const t = this.screenSendRestart.get(uid);
    if (t) clearTimeout(t);
    this.screenSendRestart.delete(uid);
    this.screenSendEarly.delete(uid);
    const pc = this.screenSendPeers.get(uid);
    if (pc) {
      try {
        pc.close();
      } catch {
        // ignore
      }
    }
    this.screenSendPeers.delete(uid);
  }

  /** Ответ (answer + кандидаты) от приёмника нашего экрана. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _applyScreenSendSignal(uid: number, signal: any) {
    const pc = this.screenSendPeers.get(uid);
    if (!pc) return;
    try {
      if (signal.sdp) {
        if (signal.type !== "answer") return; // приёмник офферить не должен
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp }));
        const queued = this.screenSendEarly.get(uid);
        if (queued && queued.length) {
          this.screenSendEarly.delete(uid);
          for (const c of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate((c as { candidate: unknown }).candidate as never));
            } catch (err) {
              console.warn("[webrtc] screen-send: drained candidate failed", err);
            }
          }
        }
      } else if (signal.candidate) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!(pc as any).remoteDescription) {
          const q = this.screenSendEarly.get(uid) ?? [];
          q.push(signal);
          this.screenSendEarly.set(uid, q);
          return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.warn("[webrtc] screen-send signal failed", err);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _applySignal(uid: number, signal: any) {
    const pc = this.peers.get(uid);
    if (!pc || !signal) return;
    try {
      if (signal.sdp) {
        // Глейр: чужой оффер пришёл, пока висит наш. Решает tie-break (меньший
        // id — инициатор), а НЕ роль прозвона: позвонивший с телефона тоже
        // «инициатор», но если вошедший позже десктоп с меньшим id офферит
        // сам (наш оффер прозвона до него не долетел), его оффер надо принять
        // — иначе обе стороны ждали бы друг друга вечно. Проигравший
        // откатывает свой оффер и отвечает; выигравший чужой отбрасывает.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (signal.type === "offer" && (pc as any).signalingState === "have-local-offer") {
          if (this.myId != null && this.myId < uid) return;
          try {
            await pc.setLocalDescription({ type: "rollback" } as never);
          } catch {
            // натив без rollback — пробуем применить как есть
          }
          this.initiators.set(uid, false);
        }
        await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
        if (signal.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this._send(uid, { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp });
        }
        // Now that the remote description is set, drain any candidates that
        // arrived before the SDP.
        const queued = this.earlyCandidates.get(uid);
        if (queued && queued.length) {
          this.earlyCandidates.delete(uid);
          for (const c of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate((c as { candidate: unknown }).candidate as never));
            } catch (err) {
              console.warn("[webrtc] drained candidate failed", err);
            }
          }
        }
      } else if (signal.renegotiate) {
        // Десктопный simple-peer-РЕСПОНДЕР не шлёт оффер сам — он просит
        // ренегосиацию нас (включил камеру, а видеослота в нашем аудио-онли
        // оффере не было). Answerer не может ДОБАВИТЬ m-line — поэтому
        // перед оффером убеждаемся, что видео-линия в нём будет (recvonly,
        // если своей камеры нет), иначе его вебка до телефона не доедет.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const trans = (pc as any).getTransceivers?.() ?? [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hasVideoLine = trans.some((t: any) =>
            t?.receiver?.track?.kind === "video" || t?.sender?.track?.kind === "video");
          if (!hasVideoLine) pc.addTransceiver("video", { direction: "recvonly" });
        } catch {
          // API транссиверов недоступен — офферим как есть
        }
        await this._renegotiate(uid, pc);
      } else if (signal.candidate) {
        // Defer if remoteDescription isn't ready yet — otherwise the candidate
        // is silently dropped and ICE never completes.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!(pc as any).remoteDescription) {
          const q = this.earlyCandidates.get(uid) ?? [];
          q.push(signal);
          this.earlyCandidates.set(uid, q);
          return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.warn("[webrtc] applySignal failed", err);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _onCallActive = (data: any) => {
    const chatId = data.chat_id as number;
    const participants: number[] = Array.isArray(data.participants) ? data.participants : [];
    // Звонок кончился (в т.ч. 60с-таймаут «не взяли» — нам приходит только
    // пустой call_active, без call_end) — его накопленные сигналы больше не
    // нужны, иначе протухший оффер всплыл бы при следующем joinOngoing.
    if (participants.length === 0) this.discardPending(chatId);
    // Only consider broadcasts for the call we're currently in.
    if (chatId !== this.chatId) return;
    // Not in the call yet (pre-accept) — don't open extra peers.
    if (!this.localStream || this.myId == null) return;
    const myId = this.myId;
    for (const uid of participants) {
      if (uid === myId) continue;
      const existing = this.peers.get(uid);
      if (!existing) {
        // Tie-breaker: the participant with the LOWER user_id initiates the
        // offer. The other side will receive that offer via call_signal and
        // create the responder peer in _onSignal. Without this both sides
        // could offer at the same time ("glare") and one of the offers would
        // be discarded.
        const initiator = myId < uid;
        this._createPeer(uid, initiator);
        continue;
      }
      // Peer есть, но той стороны в нём нет (наш оффер прозвона без ансвера:
      // собеседник был оффлайн / перезапустил приложение и вошёл теперь через
      // call_join). При обычном приёме ансвер приходит сразу за этим
      // call_active — даём 5с; не пришёл — пересобираем по tie-break'у.
      // Только для СВОИХ офферов: респондер без SDP просто ждёт, оффер —
      // забота той стороны.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasRemote = () => Boolean((existing as any).remoteDescription);
      if (!this.initiators.get(uid) || hasRemote() || this.staleTimers.has(uid)) continue;
      this.staleTimers.set(
        uid,
        setTimeout(() => {
          this.staleTimers.delete(uid);
          if (this.peers.get(uid) !== existing || !this.localStream || hasRemote()) return;
          console.log(`[webrtc] offer to ${uid} was never answered — rebuilding by tie-break`);
          this._createPeer(uid, myId < uid);
        }, 5000),
      );
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _onEnd = (data: any) => {
    const fromId = data.from_user_id as number;
    // Вне звонка (входящий ещё не принят, или это эхо собственного call_end
    // с другого нашего устройства) — только чистим очереди этого юзера,
    // чтобы протухшие сигналы отменённого звонка не всплыли в следующем.
    if (!this.localStream) {
      this.pending.delete(fromId);
      this.pendingScreen.delete(fromId);
      this.earlyCandidates.delete(fromId);
      this.screenEarly.delete(fromId);
      return;
    }
    if (data.timeout) {
      // Сервер закрыл звонок ЦЕЛИКОМ по 60с-таймауту «не взяли» — сворачиваем
      // всё, а не одного участника (иначе звонящий гудит вечно).
      this._teardown();
      return;
    }
    this.pending.delete(fromId);
    this.pendingScreen.delete(fromId);
    this._dropScreen(fromId, true);
    this._dropScreenSend(fromId);
    if (this.peers.has(fromId)) {
      this._dropPeer(fromId); // сам зовёт onPeerLeft и _teardown, если никого не осталось
    } else {
      this.earlyCandidates.delete(fromId);
      this.onPeerLeft?.(fromId);
      if (this.peers.size === 0) this._teardown();
    }
  };

  setMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  /** Включить камеру посреди звонка. Дорожки может ещё не быть (звонок
   *  стартует аудио-онли): тогда берём её у getUserMedia и раздаём peer'ам —
   *  через replaceTrack, где видеослот уже согласован, и через addTrack +
   *  ренегосиацию, где его не было. Возвращает false, если камера не дана. */
  async enableCamera(): Promise<boolean> {
    const ls = this.localStream;
    if (!ls) return false;
    const existing = ls.getVideoTracks()[0];
    // Живую дорожку просто включаем обратно (слот уже согласован).
    // МЁРТВУЮ (Андроид отобрал камеру в фоне, другое приложение перехватило)
    // выбрасываем: без этого «включить камеру» ставило enabled=true на
    // трупе, и собеседник продолжал видеть застывший кадр.
    if (existing && existing.readyState !== "ended") {
      existing.enabled = true;
      return true;
    }
    if (existing) {
      try {
        existing.stop();
      } catch {
        // уже мертва
      }
      try {
        ls.removeTrack(existing);
      } catch {
        // s'ok
      }
    }
    try {
      await ensurePermissions(true);
      const cam = await mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: this.facing } as unknown as boolean,
      });
      const track = cam.getVideoTracks()[0];
      if (!track) return false;
      ls.addTrack(track);
      for (const [uid, pc] of this.peers) {
        const sender = this.videoSenders.get(uid);
        try {
          if (sender) {
            await sender.replaceTrack(track);
            // Слот мог быть заведён, но ни разу не согласован (та сторона
            // не прислала ответа на эту m-line) — тогда replaceTrack уходит
            // в никуда. Дожимаем ренегосиацией.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const trans = (pc as any).getTransceivers?.() ?? [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tr = trans.find((t: any) => t?.sender === sender);
            if (tr && tr.currentDirection == null) await this._renegotiate(uid, pc);
          } else {
            this.videoSenders.set(uid, pc.addTrack(track, ls));
            // negotiationneeded дошлёт свежий оффер сам
          }
        } catch (err) {
          console.warn("[webrtc] attach camera failed", err);
        }
      }
      return true;
    } catch (err) {
      console.warn("[webrtc] enableCamera failed", err);
      return false;
    }
  }

  /** Жива ли наша видеодорожка. `muted` у локальной дорожки значит «источник
   *  перестал давать кадры» — ровно то, что происходит, когда Андроид
   *  отбирает камеру у свёрнутого приложения: дорожка на месте, картинка у
   *  собеседника застыла, и сама она не оживает. */
  isCameraDead(): boolean {
    const t = this.localStream?.getVideoTracks()[0];
    if (!t) return false; // камеры нет вовсе — это не «сломалась»
    return t.readyState === "ended" || t.muted === true;
  }

  /** Пересобрать видеодорожку с нуля — то же, что ручное «выкл/вкл»,
   *  которым люди и лечили застывшую картинку. */
  async restartCamera(): Promise<boolean> {
    const ls = this.localStream;
    if (!ls) return false;
    const old = ls.getVideoTracks()[0];
    if (old) {
      try {
        old.stop();
      } catch {
        // уже мертва
      }
      try {
        ls.removeTrack(old);
      } catch {
        // s'ok
      }
    }
    return this.enableCamera();
  }

  /** Выключить камеру ПОЛНОСТЬЮ (гаснет LED, не греет телефон) — не просто
   *  enabled=false. Слот в соединениях остаётся, включение обратно — через
   *  replaceTrack без ренегосиации. */
  disableCamera() {
    const ls = this.localStream;
    if (!ls) return;
    for (const sender of this.videoSenders.values()) {
      try {
        sender.replaceTrack(null);
      } catch {
        // ignore
      }
    }
    for (const track of ls.getVideoTracks()) {
      try {
        track.stop();
      } catch {
        // ignore
      }
      try {
        ls.removeTrack(track);
      } catch {
        // ignore
      }
    }
  }

  /** Переключить фронталку/заднюю во время звонка. Натив умеет мгновенно
   *  (track._switchCamera — без ренегосиации); веб — новая дорожка с нужным
   *  facingMode + replaceTrack во все соединения. */
  async switchCamera(): Promise<void> {
    const ls = this.localStream;
    const track = ls?.getVideoTracks()[0];
    if (!ls || !track) return;
    const next = this.facing === "user" ? "environment" : "user";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nativeSwitch = (track as any)._switchCamera;
    if (typeof nativeSwitch === "function") {
      try {
        nativeSwitch.call(track);
        this.facing = next;
        return;
      } catch {
        // не вышло — попробуем веб-путь ниже
      }
    }
    try {
      const cam = await mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: next } as unknown as boolean,
      });
      const newTrack = cam.getVideoTracks()[0];
      if (!newTrack) return;
      for (const sender of this.videoSenders.values()) {
        try {
          await sender.replaceTrack(newTrack);
        } catch {
          // ignore
        }
      }
      try {
        track.stop();
      } catch {
        // ignore
      }
      try {
        ls.removeTrack(track);
      } catch {
        // ignore
      }
      ls.addTrack(newTrack);
      this.facing = next;
    } catch (err) {
      console.warn("[webrtc] switchCamera failed", err);
    }
  }

  endCall() {
    if (this.chatId != null) wsService.send({ type: "call_end", chat_id: this.chatId });
    this._teardown();
  }

  private _teardown() {
    // Поток обнуляем ПЕРВЫМ: close() может синхронно дёрнуть
    // connectionstatechange → _dropPeer, и тот не должен запускать второй
    // teardown поверх этого.
    const ls = this.localStream;
    this.localStream = null;
    // Свой экран гасим ПЕРВЫМ: остановка дорожки отпускает MediaProjection
    // и foreground-сервис библиотеки; статус слать некому — звонок кончился.
    this.stopScreenShare(false);
    this.peers.forEach((pc) => {
      try {
        pc.close();
      } catch {
        // ignore
      }
    });
    this.peers.clear();
    for (const uid of Array.from(this.restartTimers.keys())) this._clearTimers(uid);
    for (const uid of Array.from(this.failTimers.keys())) this._clearTimers(uid);
    for (const uid of Array.from(this.staleTimers.keys())) this._clearTimers(uid);
    this.initiators.clear();
    this.chains.clear();
    this.outbox = [];
    for (const uid of Array.from(this.screenPeers.keys())) this._dropScreen(uid, true);
    this.pendingScreen.clear();
    this.screenEarly.clear();
    this.pending.clear();
    this.earlyCandidates.clear();
    this.remoteStreams.clear();
    this.videoSenders.clear();
    ls?.getTracks().forEach((t) => t.stop());
    this.chatId = null;
    this.facing = "user";
    this.onCallEnded?.();
  }
}

export const webrtcService = new WebRTCService();
