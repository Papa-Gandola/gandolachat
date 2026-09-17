import SimplePeer from "simple-peer";
import { wsService } from "./ws";

export interface PeerEntry {
  peer: SimplePeer.Instance;
  stream: MediaStream | null;
  userId: number;
}

type OnStreamCallback = (userId: number, stream: MediaStream) => void;
type OnPeerLeftCallback = (userId: number) => void;
type OnCallEndedCallback = () => void;

class WebRTCService {
  private peers: Map<number, SimplePeer.Instance> = new Map();
  // Separate outgoing/incoming screen peers per remote user.
  // Splitting by direction prevents "glare" when both users share simultaneously —
  // each side has one outgoing connection (we're initiator, sending our screen)
  // and one incoming (we're responder, receiving their screen).
  private screenSendingPeers: Map<number, SimplePeer.Instance> = new Map();
  private screenReceivingPeers: Map<number, SimplePeer.Instance> = new Map();
  private localStream: MediaStream | null = null;
  private localScreenStream: MediaStream | null = null;
  private currentChatId: number | null = null;
  private myUserId: number | null = null;
  // Сигналы, пришедшие ДО того, как у нас есть локальный поток (входящий
  // ещё не принят). Ключ `${userId}:${purpose}:${role}`; у записи — chat_id,
  // чтобы по концу звонка (пустой call_active) выкинуть именно его хвосты.
  private pendingSignals: Map<string, { chatId: number; signal: any }[]> = new Map();
  private _videoSenders = new Map<number, RTCRtpSender>(); // userId -> video sender (for disable/enable)
  // Метаданные webcam-peer'ов: наша роль и «видели ли SDP той стороны».
  // Инициаторский peer, так и не получивший ансвера, — «висяк» прозвона
  // (оффер до собеседника не долетел: он был оффлайн/перезапустил
  // приложение); когда он входит через call_join, висяк пересобираем по
  // tie-break'у — см. _handleCallActive/_handleSignal.
  private peerMeta = new Map<number, { initiator: boolean; remoteSdp: boolean }>();
  // Peer'ы, которые сносим САМИ (пересборка): их close — не «участник вышел».
  private silentPeers = new WeakSet<SimplePeer.Instance>();
  private staleTimers = new Map<number, number>();
  private lastParticipants: number[] = [];

  onStream: OnStreamCallback | null = null;
  onScreenStream: OnStreamCallback | null = null;
  onScreenEnded: OnPeerLeftCallback | null = null;
  onPeerLeft: OnPeerLeftCallback | null = null;
  onCallEnded: OnCallEndedCallback | null = null;

  private _initialized = false;

  init(myUserId: number) {
    this.myUserId = myUserId;
    if (this._initialized) return;
    this._initialized = true;
    wsService.on("call_signal", this._handleSignal);
    wsService.on("call_end", this._handleCallEnd);
    // Group calls: server broadcasts the participant list on every
    // call_signal. Use it to ensure every pair of participants has a peer
    // connection, not just (caller, callee). Without this, in a 3-way call
    // the two callees can't see/hear each other — only the initiator.
    wsService.on("call_active", this._handleCallActive);
    // When the OS reports network back (VPN flip, WiFi switch), force-restart ICE
    // on every active peer instead of waiting for the per-peer disconnect debounce.
    window.addEventListener("online", () => {
      const restartAll = (map: Map<number, SimplePeer.Instance>, kind: string) => {
        map.forEach((peer, uid) => {
          const pc = (peer as any)._pc as RTCPeerConnection | undefined;
          if (!pc) return;
          try {
            console.log(`[WebRTC] window.online → restartIce ${kind} peer ${uid}`);
            pc.restartIce();
          } catch {}
        });
      };
      restartAll(this.peers, "cam");
      restartAll(this.screenSendingPeers, "scr-out");
      // Receiving peers are responders — they'll get the new offer; no need to call restartIce
    });
  }

  async startCall(chatId: number, memberIds: number[], video: boolean) {
    this.currentChatId = chatId;
    this.localStream = await this._getMedia(video);

    for (const uid of memberIds) {
      if (uid === this.myUserId) continue;
      this._createPeer(uid, true);
    }

    return this.localStream;
  }

  async joinCall(chatId: number, initiatorId: number, video: boolean) {
    this.currentChatId = chatId;
    this.localStream = await this._getMedia(video);
    this._createPeer(initiatorId, false);
    this._flushPendingSignals();
    return this.localStream;
  }

  // Flush queued signals (webcam AND screen) that arrived before we got our
  // stream. Key format: `${userId}:${purpose}:${role}`
  private _flushPendingSignals() {
    for (const [key, entries] of Array.from(this.pendingSignals.entries())) {
      const [uidStr, purpose, role] = key.split(":");
      const userId = Number(uidStr);
      let targetMap: Map<number, SimplePeer.Instance>;
      if (purpose === "screen") {
        targetMap = role === "receiver" ? this.screenSendingPeers : this.screenReceivingPeers;
      } else {
        targetMap = this.peers;
      }
      // Только сигналы ТОГО чата, в который входим: звонок в ЛС, пока мы
      // входили в групповой созвон, — не наш peer (ответ ушёл бы с чужим
      // chat_id, а у звонившего всплыл бы фантомный вход).
      const signals = entries.filter((e) => e.chatId === this.currentChatId).map((e) => e.signal);
      if (signals.length === 0) continue;
      // Хвост без оффера (кандидаты соединения, оффер которого мы не видели —
      // например, после перезапуска приложения) бесполезен, а responder-peer,
      // созданный под него, заблокировал бы tie-break в _handleCallActive
      // («peer уже есть» — и никто не офферит).
      if (purpose === "webcam" && !signals.some((s) => s?.type === "offer")) continue;
      // For receiver-role screens, the sendingPeer should already exist. For others, create non-initiator.
      if (!targetMap.has(userId) && !(purpose === "screen" && role === "receiver")) {
        this._createPeer(userId, false, purpose === "screen" ? "screen" : "webcam");
      }
      for (const sig of signals) {
        if (purpose === "webcam") this._noteRemoteSdp(userId, sig);
        try { targetMap.get(userId)?.signal(sig); } catch {}
      }
    }
    this.pendingSignals.clear();
  }

  private _noteRemoteSdp(userId: number, sig: any) {
    if (sig?.type !== "offer" && sig?.type !== "answer") return;
    const meta = this.peerMeta.get(userId);
    if (meta) meta.remoteSdp = true;
  }

  private _clearStaleTimer(uid: number) {
    const t = this.staleTimers.get(uid);
    if (t != null) window.clearTimeout(t);
    this.staleTimers.delete(uid);
  }

  // Выкинуть сигналы, накопленные до входа (чата или все). После «Отклонить»
  // оффер звонящего протухает: свой peer к нам он снёс по нашему call_end, и
  // ответ на тот оффер при позднем «Присоединиться» ушёл бы в никуда — обе
  // стороны ждали бы друг друга.
  discardPending(chatId?: number) {
    if (chatId == null) { this.pendingSignals.clear(); return; }
    for (const [key, entries] of Array.from(this.pendingSignals.entries())) {
      const rest = entries.filter((e) => e.chatId !== chatId);
      if (rest.length) this.pendingSignals.set(key, rest); else this.pendingSignals.delete(key);
    }
  }

  // Присоединение к УЖЕ идущему звонку (плашка «в созвоне»). Серверу шлём
  // call_join — он рассылает call_active, и mesh дособирается сам обычным
  // tie-break'ом в _handleCallActive (меньший id офферит, глейра нет).
  // КРИТИЧНО: сначала применяем накопленные сигналы — если звонящий уже слал
  // нам оффер (мы «прозвонили» 20с и вошли позже), отвечаем ИМЕННО ему,
  // иначе его peer навсегда завис бы в have-local-offer и ЛС молчала бы.
  async joinOngoing(chatId: number, video: boolean) {
    this.currentChatId = chatId;
    this.localStream = await this._getMedia(video);
    this._flushPendingSignals();
    wsService.send({ type: "call_join", chat_id: chatId });
    return this.localStream;
  }

  private async _getMedia(video: boolean): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }

  private _createPeer(targetUserId: number, initiator: boolean, purpose: "webcam" | "screen" = "webcam") {
    let map: Map<number, SimplePeer.Instance>;
    let stream: MediaStream | null;
    if (purpose === "screen") {
      map = initiator ? this.screenSendingPeers : this.screenReceivingPeers;
      stream = initiator ? this.localScreenStream : null;
    } else {
      map = this.peers;
      stream = this.localStream;
    }

    if (!stream && purpose === "webcam") {
      console.error("[WebRTC] Cannot create webcam peer - no local stream");
      return;
    }

    // Destroy existing peer in this same slot if any (reconnect case)
    const existing = map.get(targetUserId);
    if (existing) {
      // Свой же снос — не «участник вышел». Без метки close старого peer'а
      // (simple-peer шлёт его микротаской, т.е. ПОСЛЕ map.set нового) удалял
      // бы из карты уже НОВЫЙ peer и играл звук отбоя.
      this.silentPeers.add(existing);
      existing.destroy();
      map.delete(targetUserId);
      // Пересобираем webcam-peer — старый screen-peer к этому же юзеру
      // (если шарим экран) тоже мёртв: собеседник перезапустился. Сносим,
      // иначе гард ниже («screen-peer уже есть») не открыл бы ему свежий,
      // и опоздавший экрана не видел бы до стоп/старт шаринга.
      if (purpose === "webcam") {
        const scr = this.screenSendingPeers.get(targetUserId);
        if (scr) {
          this.silentPeers.add(scr);
          scr.destroy();
          this.screenSendingPeers.delete(targetUserId);
        }
      }
    }
    if (purpose === "webcam") {
      this.peerMeta.set(targetUserId, { initiator, remoteSdp: false });
      this._clearStaleTimer(targetUserId);
    }

    const peerOpts: any = {
      initiator,
      trickle: true,
      channelConfig: { ordered: false, maxRetransmits: 0 },
      config: {
        iceCandidatePoolSize: 10,
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun.cloudflare.com:3478" },
          {
            urls: "turn:2.26.117.77:3478",
            username: "gandola",
            credential: "gandolapass",
          },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
      },
    };
    if (stream) peerOpts.stream = stream;
    const peer = new SimplePeer(peerOpts);

    peer.on("signal", (signal) => {
      console.log(`[WebRTC] ${purpose} signal out →`, targetUserId, initiator ? "(I am initiator)" : "(I am responder)");
      wsService.send({
        type: "call_signal",
        chat_id: this.currentChatId,
        target_user_id: targetUserId,
        signal,
        purpose,
        // For screen peers the remote has two matching connections (sending +
        // receiving). Tell them which of ours emitted the signal so they can
        // route the reply to the correct peer on their side.
        ...(purpose === "screen" ? { role: initiator ? "sender" : "receiver" } : {}),
      });
    });

    peer.on("stream", (s) => {
      const tracks = s.getTracks().map((t) => `${t.kind}:${t.readyState}:enabled=${t.enabled}`);
      console.log(`[WebRTC] ${purpose} stream RECEIVED from`, targetUserId, "tracks:", tracks);
      if (purpose === "screen") this.onScreenStream?.(targetUserId, s);
      else this.onStream?.(targetUserId, s);
    });

    peer.on("track", (track, stream) => {
      console.log(`[WebRTC] ${purpose} track RECEIVED from`, targetUserId, track.kind, track.id.slice(0, 8), "readyState:", track.readyState);
    });

    peer.on("connect", () => {
      console.log(`[WebRTC] ${purpose} CONNECTED to peer`, targetUserId);
    });

    // Auto-recovery: when the underlying ICE connection drops (e.g. user toggles
    // VPN, switches WiFi → mobile, etc) restart ICE instead of letting the peer die.
    // Only the initiator side actually triggers restartIce — the responder will pick up
    // the new candidates via the normal signaling.
    const pc2 = (peer as any)._pc as RTCPeerConnection | undefined;
    if (pc2) {
      let restartScheduled = false;
      const tryRestart = (reason: string) => {
        if (restartScheduled) return;
        restartScheduled = true;
        setTimeout(() => {
          restartScheduled = false;
          // Only restart if still in trouble after the debounce
          const st = pc2.iceConnectionState;
          if (st !== "disconnected" && st !== "failed") return;
          if (!initiator) return; // responder waits for the initiator's new offer
          try {
            console.log(`[WebRTC] ICE restart for ${purpose} peer ${targetUserId} (${reason}, state=${st})`);
            pc2.restartIce();
          } catch (err) {
            console.error("[WebRTC] restartIce failed", err);
          }
        }, 2000);
      };
      pc2.addEventListener("iceconnectionstatechange", () => {
        const st = pc2.iceConnectionState;
        console.log(`[WebRTC] ${purpose} ICE ${targetUserId}: ${st}`);
        if (st === "disconnected" || st === "failed") tryRestart(`ice=${st}`);
      });
    }

    peer.on("close", () => {
      if (map.get(targetUserId) !== peer) return; // слот уже занят свежим peer'ом — это эхо старого
      map.delete(targetUserId);
      if (purpose === "webcam") this.peerMeta.delete(targetUserId);
      if (this.silentPeers.has(peer)) return;
      if (purpose === "screen") {
        // Only notify the UI when an INCOMING screen peer closes (remote stopped sharing).
        // Our own outgoing peer closing is just us stopping the share locally.
        if (!initiator) this.onScreenEnded?.(targetUserId);
      } else {
        this.onPeerLeft?.(targetUserId);
      }
    });

    peer.on("error", (err) => {
      console.error(`[WebRTC] ${purpose} peer error with`, targetUserId, err);
      if (map.get(targetUserId) !== peer) return;
      map.delete(targetUserId);
      if (purpose === "webcam") this.peerMeta.delete(targetUserId);
      if (this.silentPeers.has(peer)) return;
      if (purpose === "screen") {
        if (!initiator) this.onScreenEnded?.(targetUserId);
      } else {
        this.onPeerLeft?.(targetUserId);
      }
    });

    map.set(targetUserId, peer);
    // Мы уже шарим экран, а это новый участник (вошёл в идущий созвон):
    // раньше startScreenShare открывал screen-peer только тем, кто был в
    // звонке на момент старта, и опоздавший экрана не видел.
    if (purpose === "webcam" && this.localScreenStream && !this.screenSendingPeers.has(targetUserId)) {
      this._createPeer(targetUserId, true, "screen");
    }
    if (purpose === "webcam" && pc2) {
      const vSender = pc2.getSenders().find((s: any) => s.track?.kind === "video");
      if (vSender) {
        this._videoSenders.set(targetUserId, vSender as RTCRtpSender);
      } else {
        // Started audio-only (camera-off pref): add a null video transceiver so
        // enableVideo() can replaceTrack without full renegotiation later.
        try {
          const transceiver = pc2.addTransceiver("video", { direction: "sendrecv" });
          this._videoSenders.set(targetUserId, transceiver.sender);
        } catch {}
      }
    }
  }

  private _handleSignal = (data: any) => {
    const fromId = data.from_user_id;
    const purpose: "webcam" | "screen" = data.purpose === "screen" ? "screen" : "webcam";
    const remoteRole: "sender" | "receiver" | undefined = data.role;
    const sig = data.signal;
    const sigType: string | undefined = sig?.type;
    console.log(`[WebRTC] signal IN ←`, fromId, `purpose=${data.purpose ?? "<missing>"} role=${remoteRole ?? "-"} sig=${sigType ?? "candidate"}`);

    // Queue pre-join signals under a key that also distinguishes role, so
    // flush later routes them correctly.
    const queueKey = `${fromId}:${purpose}:${remoteRole ?? "?"}`;
    if (!this.localStream) {
      if (!this.pendingSignals.has(queueKey)) this.pendingSignals.set(queueKey, []);
      this.pendingSignals.get(queueKey)!.push({ chatId: Number(data.chat_id), signal: sig });
      return;
    }

    // Route based on remote role:
    //  - remote "sender" (their initiator peer) → my receiving peer (create if missing)
    //  - remote "receiver" (their responder peer) → my sending peer (must already exist)
    //  - webcam (no role) → my single webcam peer
    let map: Map<number, SimplePeer.Instance>;
    let createIfMissing: boolean;
    if (purpose === "screen") {
      if (remoteRole === "receiver") {
        map = this.screenSendingPeers;
        createIfMissing = false;
      } else {
        map = this.screenReceivingPeers;
        createIfMissing = true;
      }
    } else {
      map = this.peers;
      createIfMissing = true;
      const meta = this.peerMeta.get(fromId);
      if (sigType === "offer" && map.has(fromId) && meta?.initiator && !meta.remoteSdp) {
        // Наш оффер прозвона так и висит без ответа, а собеседник вошёл через
        // call_join и по tie-break'у офферит сам — уступаем: висяк долой,
        // отвечаем свежим responder-peer'ом. Иначе simple-peer падал на
        // setRemoteDescription(offer) в have-local-offer, оффер терялся, и
        // обе стороны ждали друг друга вечно.
        console.log(`[WebRTC] offer from ${fromId} hits my unanswered offer — yielding (responder)`);
        this._createPeer(fromId, false, "webcam");
      } else if (!map.has(fromId) && sigType !== "offer") {
        // Ансвер/кандидат без peer'а — хвост соединения, которого у нас уже
        // нет (снесли по call_end / пересобрали). Responder-peer, скормленный
        // ансвером, тут же падал бы, а созданный под кандидаты — блокировал
        // tie-break («peer есть»). Свежий оффер той стороны создаст peer как
        // обычно.
        console.warn(`[WebRTC] ${sigType ?? "candidate"} from ${fromId} without a peer — dropped`);
        return;
      }
    }

    if (!map.has(fromId)) {
      if (!createIfMissing) {
        console.warn(`[WebRTC] got ${purpose} signal from ${fromId} but no matching peer (role=${remoteRole})`);
        return;
      }
      this._createPeer(fromId, false, purpose);
    }
    if (purpose === "webcam") this._noteRemoteSdp(fromId, sig);

    try {
      map.get(fromId)?.signal(sig);
    } catch (err) {
      console.error(`[WebRTC] ${purpose} signal error`, fromId, err);
      if (createIfMissing) {
        this._createPeer(fromId, false, purpose);
        if (purpose === "webcam") this._noteRemoteSdp(fromId, sig);
        try { map.get(fromId)?.signal(sig); } catch {}
      }
    }
  };

  private _handleCallActive = (data: any) => {
    const chatId = data.chat_id as number;
    const participants: number[] = Array.isArray(data.participants) ? data.participants : [];
    // Звонок кончился — его сигналы, накопленные до входа, больше не нужны
    // (иначе протухший оффер всплыл бы при joinOngoing в СЛЕДУЮЩИЙ звонок).
    if (participants.length === 0) this.discardPending(chatId);
    // Only act on broadcasts for the call we're currently in.
    if (chatId !== this.currentChatId) return;
    // Not in the call yet (haven't accepted) — skip; joinCall handles
    // the initial peer for us.
    if (!this.localStream || this.myUserId == null) return;
    const myId = this.myUserId;
    this.lastParticipants = participants;
    for (const uid of participants) {
      if (uid === myId) continue;
      if (!this.peers.has(uid)) {
        // Tie-breaker: the participant with the LOWER user_id initiates the
        // offer. The other side will receive that offer via call_signal and
        // become responder in _handleSignal. Without this both sides would
        // try to offer at the same time ("glare").
        const initiator = myId < uid;
        this._createPeer(uid, initiator, "webcam");
        continue;
      }
      // Peer есть, но SDP той стороны мы не видели, а инициатор — мы. При
      // обычном ответе на звонок ансвер приходит СРАЗУ за этим call_active
      // (сервер рассылает состав до пересылки сигнала) — даём 5с. Не пришёл
      // — это висяк прозвона: собеседник наш оффер не получал (был оффлайн,
      // перезапустил приложение) и вошёл через call_join. Пересобираем по
      // tie-break'у — меньший id офферит; раньше «peer уже есть → skip»
      // оставлял обе стороны ждать друг друга вечно («не получается
      // зайти через Присоединиться»). Responder без SDP не трогаем —
      // оффер там забота той стороны.
      const meta = this.peerMeta.get(uid);
      if (!meta || !meta.initiator || meta.remoteSdp || this.staleTimers.has(uid)) continue;
      const stalePeer = this.peers.get(uid)!;
      this.staleTimers.set(uid, window.setTimeout(() => {
        this.staleTimers.delete(uid);
        const m = this.peerMeta.get(uid);
        if (!this.localStream || this.peers.get(uid) !== stalePeer || !m || m.remoteSdp) return;
        if (!this.lastParticipants.includes(uid)) return;
        console.log(`[WebRTC] my offer to ${uid} was never answered — rebuilding by tie-break`);
        this._createPeer(uid, myId < uid, "webcam");
      }, 5000));
    }
  };

  private _handleCallEnd = (data: any) => {
    const fromId = data.from_user_id;
    // Вне звонка: чистим накопленные сигналы этого юзера — протухший оффер
    // отменённого звонка не должен всплыть при joinOngoing в СЛЕДУЮЩИЙ.
    if (!this.localStream) {
      for (const key of Array.from(this.pendingSignals.keys())) {
        if (key.startsWith(`${fromId}:`)) this.pendingSignals.delete(key);
      }
      return;
    }
    if (data.timeout) {
      // 60с никто не взял — сервер закрыл звонок ЦЕЛИКОМ. Сворачиваем всё
      // локально: раньше звонящий оставался «в звонке» с захваченным микро,
      // потому что рвался только один peer.
      this.peers.forEach((p) => { try { p.destroy(); } catch {} });
      this.peers.clear();
      this.screenSendingPeers.forEach((p) => { try { p.destroy(); } catch {} });
      this.screenSendingPeers.clear();
      this.screenReceivingPeers.forEach((p) => { try { p.destroy(); } catch {} });
      this.screenReceivingPeers.clear();
      this.pendingSignals.clear();
      this._videoSenders.clear();
      this.peerMeta.clear();
      for (const uid of Array.from(this.staleTimers.keys())) this._clearStaleTimer(uid);
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      this.localScreenStream?.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
      this.currentChatId = null;
      this.onCallEnded?.();
      return;
    }
    this.peers.get(fromId)?.destroy();
    this.peers.delete(fromId);
    this.peerMeta.delete(fromId);
    this._clearStaleTimer(fromId);
    this.screenSendingPeers.get(fromId)?.destroy();
    this.screenSendingPeers.delete(fromId);
    this.screenReceivingPeers.get(fromId)?.destroy();
    this.screenReceivingPeers.delete(fromId);
    this.onScreenEnded?.(fromId);
    this.onPeerLeft?.(fromId);

    if (this.peers.size === 0 && this.localStream) {
      if (this.currentChatId) {
        wsService.send({ type: "call_end", chat_id: this.currentChatId });
      }
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      this.localScreenStream?.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
      this.currentChatId = null;
      this._videoSenders.clear();
      this.onCallEnded?.();
    }
  };

  endCall() {
    if (this.currentChatId) {
      wsService.send({ type: "call_end", chat_id: this.currentChatId });
    }
    this.peers.forEach((p) => p.destroy());
    this.peers.clear();
    this.screenSendingPeers.forEach((p) => p.destroy());
    this.screenSendingPeers.clear();
    this.screenReceivingPeers.forEach((p) => p.destroy());
    this.screenReceivingPeers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.localScreenStream?.getTracks().forEach((t) => t.stop());
    this.localScreenStream = null;
    this.currentChatId = null;
    this.pendingSignals.clear();
    this._videoSenders.clear();
    this.peerMeta.clear();
    for (const uid of Array.from(this.staleTimers.keys())) this._clearStaleTimer(uid);
    this.lastParticipants = [];
    if (this.gainContext) {
      this.gainContext.close().catch(() => {});
      this.gainContext = null;
      this.gainNode = null;
    }
  }

  // Replace the outgoing video track on every webcam peer (e.g. user changed camera).
  // Screen-share peers are independent and not affected.
  replaceVideoTrack(newTrack: MediaStreamTrack) {
    this.peers.forEach((peer) => {
      const pc = (peer as any)._pc;
      if (!pc) return;
      const sender = pc.getSenders?.()?.find((s: any) => s.track?.kind === "video");
      if (sender) {
        sender.replaceTrack(newTrack).catch((err: any) => {
          console.error("[WebRTC] replaceTrack(video) failed", err);
        });
      }
    });
  }

  // Stop local video tracks (releases camera hardware) and null out peer senders.
  // Keeps senders alive so enableVideo() can replaceTrack without renegotiation.
  disableVideo(): void {
    this.localStream?.getVideoTracks().forEach((t) => t.stop());
    this._videoSenders.forEach((sender) => {
      (sender as any).replaceTrack(null).catch(() => {});
    });
  }

  // Re-acquire the camera, add the new track to localStream, and push it to all peer senders.
  async enableVideo(): Promise<void> {
    if (!this.localStream) return;
    const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    const newTrack = camStream.getVideoTracks()[0];
    if (!newTrack) return;
    this.localStream.getVideoTracks().forEach((t) => { t.stop(); this.localStream!.removeTrack(t); });
    this.localStream.addTrack(newTrack);
    this._videoSenders.forEach((sender) => {
      (sender as any).replaceTrack(newTrack).catch(() => {});
    });
    // Транссивер, добавленный НЕ-инициатором при audio-only старте, ни разу
    // не согласован (currentDirection === null): replaceTrack в него уходит
    // в никуда, и собеседник (особенно телефон) кадров не получает. Такие
    // соединения пересогласовываем — simple-peer дошлёт свежий оффер.
    this.peers.forEach((peer, uid) => {
      try {
        const pc2: RTCPeerConnection | undefined = (peer as any)._pc;
        const sender = this._videoSenders.get(uid);
        if (!pc2 || !sender) return;
        const tr = pc2.getTransceivers().find((t) => t.sender === sender);
        if (tr && tr.currentDirection == null) (peer as any).negotiate();
      } catch {
        // best-effort — обычный replaceTrack уже сделан
      }
    });
  }

  // Inspect every active peer connection and report whether the selected ICE
  // candidate pair uses a TURN relay. Returns the worst of the bunch so the UI
  // can warn when at least one peer is going through a relay.
  async getConnectionQuality(): Promise<{ usingRelay: boolean; details: string[] }> {
    const details: string[] = [];
    let usingRelay = false;
    const allPeers = [
      ...Array.from(this.peers.entries()).map(([uid, p]) => ({ uid, p, kind: "cam" })),
      ...Array.from(this.screenSendingPeers.entries()).map(([uid, p]) => ({ uid, p, kind: "scr-out" })),
      ...Array.from(this.screenReceivingPeers.entries()).map(([uid, p]) => ({ uid, p, kind: "scr-in" })),
    ];
    for (const { uid, p, kind } of allPeers) {
      const pc = (p as any)._pc as RTCPeerConnection | undefined;
      if (!pc) continue;
      try {
        const stats = await pc.getStats();
        // Find the in-use candidate pair, then look up its local + remote candidate types
        let pairType: string | null = null;
        let localType = "?";
        let remoteType = "?";
        const localById: Record<string, any> = {};
        const remoteById: Record<string, any> = {};
        let pair: any = null;
        stats.forEach((report: any) => {
          if (report.type === "local-candidate") localById[report.id] = report;
          if (report.type === "remote-candidate") remoteById[report.id] = report;
          if (report.type === "candidate-pair" && (report.selected || report.nominated) && report.state === "succeeded") {
            pair = report;
          }
        });
        if (pair) {
          localType = localById[pair.localCandidateId]?.candidateType ?? "?";
          remoteType = remoteById[pair.remoteCandidateId]?.candidateType ?? "?";
          pairType = `${localType}/${remoteType}`;
          if (localType === "relay" || remoteType === "relay") usingRelay = true;
        }
        details.push(`${kind} u${uid}: ${pairType ?? "no-pair"}`);
      } catch {}
    }
    return { usingRelay, details };
  }

  // Replace the outgoing audio track on every webcam peer (e.g. user changed mic).
  replaceAudioTrack(newTrack: MediaStreamTrack) {
    this.peers.forEach((peer) => {
      const pc = (peer as any)._pc;
      if (!pc) return;
      const sender = pc.getSenders?.()?.find((s: any) => s.track?.kind === "audio");
      if (sender) {
        sender.replaceTrack(newTrack).catch((err: any) => {
          console.error("[WebRTC] replaceTrack(audio) failed", err);
        });
      }
    });
  }

  // Смена микрофона посреди звонка. deviceId "" = системный по умолчанию
  // (audio: true — ровно как при входе в звонок). Виртуальные id Chromium'а
  // «default»/«communications» НЕ запрашиваем: на Windows выбор «default»
  // после смены устройства давал немой трек (все переставали слышать), а
  // тот же микрофон по физическому id работал. Новый трек сперва проверяем
  // на живость и только потом гасим старый — при неудаче звонок остаётся на
  // прежнем микрофоне, а не без звука. Мьют переносится на новый трек.
  async switchMicrophone(deviceId: string, opts: { muted: boolean; gain: number }): Promise<MediaStreamTrack> {
    const ls = this.localStream;
    if (!ls) throw new Error("not in a call");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    });
    const newTrack = stream.getAudioTracks()[0];
    if (!newTrack) throw new Error("no audio track");
    if (!(await this._waitTrackLive(newTrack, 4000))) {
      newTrack.stop();
      throw new Error("microphone produced no audio (muted track)");
    }
    newTrack.enabled = !opts.muted;
    const old = ls.getAudioTracks();
    // Сначала добавить, потом убрать: анализатор «говорю» и gain-контекст
    // берут ПЕРВУЮ аудиодорожку потока.
    ls.addTrack(newTrack);
    old.forEach((t) => { ls.removeTrack(t); t.stop(); });
    this.replaceAudioTrack(newTrack);
    // Gain-контекст привязан к старой дорожке — пересобрать под новую.
    this.resetGainContext();
    if (opts.gain !== 100) this.setMicGain(opts.gain);
    return newTrack;
  }

  // Дорожка «живая», когда readyState=live и не muted (muted у только что
  // открытого устройства = данных нет; Bluetooth-гарнитура может
  // раскачиваться пару секунд — ждём unmute до таймаута).
  private _waitTrackLive(track: MediaStreamTrack, timeoutMs: number): Promise<boolean> {
    if (track.readyState !== "live") return Promise.resolve(false);
    if (!track.muted) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok: boolean) => { window.clearTimeout(timer); track.removeEventListener("unmute", onUnmute); resolve(ok); };
      const onUnmute = () => done(true);
      const timer = window.setTimeout(() => done(track.readyState === "live" && !track.muted), timeoutMs);
      track.addEventListener("unmute", onUnmute);
    });
  }

  // Starts a dedicated OUTGOING screen peer connection to every current webcam peer.
  // Runs in addition to webcam, and lives in a different slot than any incoming
  // screen peer from that same user, so both directions can share simultaneously.
  startScreenShare(screenStream: MediaStream) {
    this.localScreenStream = screenStream;
    const targets = Array.from(this.peers.keys());
    for (const uid of targets) {
      this._createPeer(uid, true, "screen");
    }
  }

  stopScreenShare() {
    // Only tear down OUR outgoing screen peers, leaving any incoming screens intact.
    this.screenSendingPeers.forEach((p) => p.destroy());
    this.screenSendingPeers.clear();
    this.localScreenStream?.getTracks().forEach((t) => t.stop());
    this.localScreenStream = null;
  }

  // Mic gain (0-200%) via Web Audio API
  private gainContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  resetGainContext() {
    if (this.gainContext) {
      this.gainContext.close().catch(() => {});
      this.gainContext = null;
      this.gainNode = null;
    }
  }

  setMicGain(gain: number) {
    if (!this.localStream) return;
    if (!this.gainContext) {
      try {
        this.gainContext = new AudioContext();
        const source = this.gainContext.createMediaStreamSource(this.localStream);
        this.gainNode = this.gainContext.createGain();
        const dest = this.gainContext.createMediaStreamDestination();
        source.connect(this.gainNode);
        this.gainNode.connect(dest);
        const newTrack = dest.stream.getAudioTracks()[0];
        // Replace audio track in all existing peers
        this.peers.forEach((peer) => {
          const sender = (peer as any)._pc?.getSenders?.()?.find((s: any) => s.track?.kind === "audio");
          if (sender) sender.replaceTrack(newTrack);
        });
      } catch (err) {
        console.error("[WebRTC] setMicGain error", err);
        return;
      }
    }
    if (this.gainNode) {
      this.gainNode.gain.value = gain / 100;
    }
  }

  // Clean up gain context when call ends

  getLocalStream() {
    return this.localStream;
  }

  isInCall() {
    return this.localStream !== null;
  }

  getCurrentChatId() {
    return this.currentChatId;
  }

  // Set output device on all remote audio elements
  async setOutputDevice(deviceId: string) {
    // This needs to be called on HTMLAudioElement — handled by VideoCall component
  }
}

export const webrtcService = new WebRTCService();
