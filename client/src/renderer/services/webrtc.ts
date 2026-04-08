import SimplePeer from "simple-peer";
import { wsService } from "./ws";

export interface PeerEntry {
  peer: SimplePeer.Instance;
  stream: MediaStream | null;
  userId: number;
}

type OnStreamCallback = (userId: number, stream: MediaStream) => void;
type OnPeerLeftCallback = (userId: number) => void;

class WebRTCService {
  private peers: Map<number, SimplePeer.Instance> = new Map();
  private localStream: MediaStream | null = null;
  private currentChatId: number | null = null;
  private myUserId: number | null = null;
  private pendingSignals: Map<number, any[]> = new Map();

  onStream: OnStreamCallback | null = null;
  onPeerLeft: OnPeerLeftCallback | null = null;

  private _initialized = false;

  init(myUserId: number) {
    this.myUserId = myUserId;
    if (this._initialized) return;
    this._initialized = true;
    wsService.on("call_signal", this._handleSignal);
    wsService.on("call_end", this._handleCallEnd);
  }

  async startCall(chatId: number, memberIds: number[], video: boolean) {
    this.currentChatId = chatId;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video,
      });
    } catch {
      // Camera busy — fallback to audio only
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    }

    // Initiate connection with each member
    for (const uid of memberIds) {
      if (uid === this.myUserId) continue;
      this._createPeer(uid, true);
    }

    return this.localStream;
  }

  async joinCall(chatId: number, initiatorId: number, video: boolean) {
    this.currentChatId = chatId;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video,
      });
    } catch {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    }
    this._createPeer(initiatorId, false);

    // Flush signals that arrived before we joined
    const queued = this.pendingSignals.get(initiatorId) || [];
    for (const signal of queued) {
      this.peers.get(initiatorId)?.signal(signal);
    }
    this.pendingSignals.delete(initiatorId);

    return this.localStream;
  }

  private _createPeer(targetUserId: number, initiator: boolean) {
    const peer = new SimplePeer({
      initiator,
      stream: this.localStream!,
      trickle: true,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      },
    });

    peer.on("signal", (signal) => {
      wsService.send({
        type: "call_signal",
        chat_id: this.currentChatId,
        target_user_id: targetUserId,
        signal,
      });
    });

    peer.on("stream", (stream) => {
      this.onStream?.(targetUserId, stream);
    });

    peer.on("connect", () => {
      console.log("[WebRTC] Connected to peer", targetUserId);
    });

    peer.on("close", () => {
      this.peers.delete(targetUserId);
      this.onPeerLeft?.(targetUserId);
    });

    peer.on("error", (err) => {
      console.error("[WebRTC] Peer error with", targetUserId, err);
      this.peers.delete(targetUserId);
    });

    this.peers.set(targetUserId, peer);
  }

  private _handleSignal = (data: any) => {
    const fromId = data.from_user_id;

    if (!this.localStream) {
      // Buffer signals until joinCall is called
      if (!this.pendingSignals.has(fromId)) {
        this.pendingSignals.set(fromId, []);
      }
      this.pendingSignals.get(fromId)!.push(data.signal);
      return;
    }

    if (!this.peers.has(fromId)) {
      this._createPeer(fromId, false);
    }
    this.peers.get(fromId)?.signal(data.signal);
  };

  private _handleCallEnd = (data: any) => {
    const fromId = data.from_user_id;
    this.peers.get(fromId)?.destroy();
    this.peers.delete(fromId);
    this.onPeerLeft?.(fromId);
  };

  endCall() {
    if (this.currentChatId) {
      wsService.send({ type: "call_end", chat_id: this.currentChatId });
    }
    this.peers.forEach((p) => p.destroy());
    this.peers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.currentChatId = null;
    this.pendingSignals.clear();
  }

  getLocalStream() {
    return this.localStream;
  }

  isInCall() {
    return this.localStream !== null;
  }
}

export const webrtcService = new WebRTCService();
