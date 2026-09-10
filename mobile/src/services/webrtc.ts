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
  try {
    await PermissionsAndroid.requestMultiple(perms);
  } catch {
    // ignore — getUserMedia will surface the failure
  }
}

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
  private pending = new Map<number, unknown[]>();
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

  onStream: StreamCb | null = null;
  onPeerLeft: LeftCb | null = null;
  onCallEnded: EndedCb | null = null;

  init(myId: number) {
    this.myId = myId;
    // wsService.disconnect() (логаут) стирает ВСЕ хендлеры разом. Поэтому
    // перевешиваем свои при каждом init (off → on = идемпотентно) — иначе
    // после перелогина в том же процессе входящие звонки мертвы.
    wsService.off("call_signal", this._onSignal);
    wsService.off("call_end", this._onEnd);
    wsService.off("call_active", this._onCallActive);
    wsService.on("call_signal", this._onSignal);
    wsService.on("call_end", this._onEnd);
    // Group calls: the server broadcasts the full participant list on each
    // call_signal. We use it to ensure every pair of participants is
    // connected (mesh) — a brand-new joiner sees everyone, and existing
    // members open a connection to them.
    wsService.on("call_active", this._onCallActive);
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
    // Flush every queued signal now that we have a peer + local media.
    // Order matters: SDP (offer/answer) MUST land before any ICE candidate,
    // otherwise addIceCandidate throws because remoteDescription is null and
    // the candidate is lost — ICE never completes and the call sticks on
    // "waiting for participant". Sort SDP-first and await each apply to keep
    // them strictly sequential.
    for (const [uid, sigs] of Array.from(this.pending.entries())) {
      if (!this.peers.has(uid)) this._createPeer(uid, false);
      const ordered = [...sigs].sort((a, b) => {
        const aSdp = (a as { sdp?: string } | null)?.sdp ? 0 : 1;
        const bSdp = (b as { sdp?: string } | null)?.sdp ? 0 : 1;
        return aSdp - bSdp;
      });
      for (const s of ordered) await this._applySignal(uid, s);
    }
    this.pending.clear();
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
    const pc = new RTCPeerConnection(ICE_CONFIG);
    this.peers.set(uid, pc);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream);
        if (track.kind === "video") this.videoSenders.set(uid, sender);
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
    pc.addEventListener("negotiationneeded", async () => {
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
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc.addEventListener("connectionstatechange", () => {
      const st = (pc as unknown as { connectionState?: string }).connectionState;
      if (st === "failed" || st === "closed") {
        this.peers.delete(uid);
        this.remoteStreams.delete(uid);
        this.videoSenders.delete(uid);
        this.onPeerLeft?.(uid);
        if (this.peers.size === 0) this._teardown();
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
    return pc;
  }

  private _send(uid: number, signal: unknown) {
    wsService.send({
      type: "call_signal",
      chat_id: this.chatId,
      target_user_id: uid,
      signal,
      purpose: "webcam",
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _onSignal = (data: any) => {
    const fromId = data.from_user_id as number;
    if (data.purpose === "screen") return; // screen-share not supported on mobile yet
    const signal = data.signal;
    if (!this.localStream) {
      // Not in a call yet (incoming, awaiting accept) — queue.
      const q = this.pending.get(fromId) ?? [];
      q.push(signal);
      this.pending.set(fromId, q);
      return;
    }
    if (!this.peers.has(fromId)) this._createPeer(fromId, false);
    this._applySignal(fromId, signal);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _applySignal(uid: number, signal: any) {
    const pc = this.peers.get(uid);
    if (!pc || !signal) return;
    try {
      if (signal.sdp) {
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
    // Only consider broadcasts for the call we're currently in.
    if (chatId !== this.chatId) return;
    // Not in the call yet (pre-accept) — don't open extra peers.
    if (!this.localStream || this.myId == null) return;
    const participants: number[] = Array.isArray(data.participants) ? data.participants : [];
    for (const uid of participants) {
      if (uid === this.myId) continue;
      if (this.peers.has(uid)) continue;
      // Tie-breaker: the participant with the LOWER user_id initiates the
      // offer. The other side will receive that offer via call_signal and
      // create the responder peer in _onSignal. Without this both sides
      // could offer at the same time ("glare") and one of the offers would
      // be discarded.
      const initiator = this.myId < uid;
      this._createPeer(uid, initiator);
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
      this.earlyCandidates.delete(fromId);
      return;
    }
    this.pending.delete(fromId);
    this.earlyCandidates.delete(fromId);
    this.remoteStreams.delete(fromId);
    this.videoSenders.delete(fromId);
    const pc = this.peers.get(fromId);
    if (pc) {
      try {
        pc.close();
      } catch {
        // ignore
      }
      this.peers.delete(fromId);
    }
    this.onPeerLeft?.(fromId);
    if (this.peers.size === 0) this._teardown();
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
    if (existing) {
      existing.enabled = true;
      return true;
    }
    try {
      await ensurePermissions(true);
      const cam = await mediaDevices.getUserMedia({ audio: false, video: true });
      const track = cam.getVideoTracks()[0];
      if (!track) return false;
      ls.addTrack(track);
      for (const [uid, pc] of this.peers) {
        const sender = this.videoSenders.get(uid);
        try {
          if (sender) {
            await sender.replaceTrack(track);
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

  endCall() {
    if (this.chatId != null) wsService.send({ type: "call_end", chat_id: this.chatId });
    this._teardown();
  }

  private _teardown() {
    this.peers.forEach((pc) => {
      try {
        pc.close();
      } catch {
        // ignore
      }
    });
    this.peers.clear();
    this.pending.clear();
    this.earlyCandidates.clear();
    this.remoteStreams.clear();
    this.videoSenders.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.chatId = null;
    this.onCallEnded?.();
  }
}

export const webrtcService = new WebRTCService();
