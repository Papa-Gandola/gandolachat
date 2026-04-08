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
  private localStream: MediaStream | null = null;
  private currentChatId: number | null = null;
  private myUserId: number | null = null;
  private pendingSignals: Map<number, any[]> = new Map();

  onStream: OnStreamCallback | null = null;
  onPeerLeft: OnPeerLeftCallback | null = null;
  onCallEnded: OnCallEndedCallback | null = null;

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

    // Flush signals that arrived before we joined
    const queued = this.pendingSignals.get(initiatorId) || [];
    for (const signal of queued) {
      this.peers.get(initiatorId)?.signal(signal);
    }
    this.pendingSignals.delete(initiatorId);

    // Also flush signals from other users (group call - multiple people may have sent signals)
    for (const [userId, signals] of this.pendingSignals.entries()) {
      if (!this.peers.has(userId)) {
        // In a group call, if someone else sent signals, we're the non-initiator
        this._createPeer(userId, false);
      }
      for (const sig of signals) {
        this.peers.get(userId)?.signal(sig);
      }
    }
    this.pendingSignals.clear();

    return this.localStream;
  }

  private async _getMedia(video: boolean): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }

  private _createPeer(targetUserId: number, initiator: boolean) {
    if (!this.localStream) {
      console.error("[WebRTC] Cannot create peer - no local stream");
      return;
    }

    // Destroy existing peer if any (reconnect case)
    const existing = this.peers.get(targetUserId);
    if (existing) {
      existing.destroy();
      this.peers.delete(targetUserId);
    }

    const peer = new SimplePeer({
      initiator,
      stream: this.localStream,
      trickle: true,
      channelConfig: { ordered: false, maxRetransmits: 0 },
      config: {
        iceCandidatePoolSize: 10,
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun.cloudflare.com:3478" },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
          {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
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
      this.onPeerLeft?.(targetUserId);
    });

    this.peers.set(targetUserId, peer);
  }

  private _handleSignal = (data: any) => {
    const fromId = data.from_user_id;

    if (!this.localStream) {
      if (!this.pendingSignals.has(fromId)) {
        this.pendingSignals.set(fromId, []);
      }
      this.pendingSignals.get(fromId)!.push(data.signal);
      return;
    }

    if (!this.peers.has(fromId)) {
      // New participant joining — they initiated, we respond
      this._createPeer(fromId, false);
    }

    try {
      this.peers.get(fromId)?.signal(data.signal);
    } catch (err) {
      console.error("[WebRTC] Signal error, recreating peer", fromId, err);
      this._createPeer(fromId, false);
      try {
        this.peers.get(fromId)?.signal(data.signal);
      } catch {}
    }
  };

  private _handleCallEnd = (data: any) => {
    const fromId = data.from_user_id;
    this.peers.get(fromId)?.destroy();
    this.peers.delete(fromId);
    this.onPeerLeft?.(fromId);

    if (this.peers.size === 0 && this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      this.currentChatId = null;
      this.onCallEnded?.();
    }
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

  replaceVideoTrack(newTrack: MediaStreamTrack) {
    this.peers.forEach((peer) => {
      const sender = (peer as any)._pc?.getSenders?.()?.find((s: any) => s.track?.kind === "video");
      if (sender) {
        sender.replaceTrack(newTrack);
      }
    });
  }

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
