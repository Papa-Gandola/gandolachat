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
  // Separate peer connections dedicated to screen share (one per remote user).
  // This lets remote users see webcam AND screen simultaneously in two tiles.
  private screenPeers: Map<number, SimplePeer.Instance> = new Map();
  private localStream: MediaStream | null = null;
  private localScreenStream: MediaStream | null = null;
  private currentChatId: number | null = null;
  private myUserId: number | null = null;
  private pendingSignals: Map<string, any[]> = new Map(); // key = `${userId}:${purpose}`

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
    const queued = this.pendingSignals.get(`${initiatorId}:webcam`) || [];
    for (const signal of queued) {
      this.peers.get(initiatorId)?.signal(signal);
    }
    this.pendingSignals.delete(`${initiatorId}:webcam`);

    // Also flush signals from other users (group call - multiple people may have sent signals)
    for (const [key, signals] of this.pendingSignals.entries()) {
      const [uidStr, purpose] = key.split(":");
      const userId = Number(uidStr);
      if (purpose !== "webcam") continue;
      if (!this.peers.has(userId)) {
        this._createPeer(userId, false);
      }
      for (const sig of signals) {
        this.peers.get(userId)?.signal(sig);
      }
    }
    // Drop all webcam-queued signals; screen signals will process when screen peer is created
    Array.from(this.pendingSignals.keys()).forEach((k) => {
      if (k.endsWith(":webcam")) this.pendingSignals.delete(k);
    });

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
    const map = purpose === "screen" ? this.screenPeers : this.peers;
    const stream = purpose === "screen" ? this.localScreenStream : this.localStream;

    if (!stream && purpose === "webcam") {
      console.error("[WebRTC] Cannot create webcam peer - no local stream");
      return;
    }
    if (purpose === "screen" && !stream) {
      // Remote screen peer: we're receiving, no local screen to send → create without stream
    }

    // Destroy existing peer if any (reconnect case)
    const existing = map.get(targetUserId);
    if (existing) {
      existing.destroy();
      map.delete(targetUserId);
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
      wsService.send({
        type: "call_signal",
        chat_id: this.currentChatId,
        target_user_id: targetUserId,
        signal,
        purpose,
      });
    });

    peer.on("stream", (s) => {
      console.log(`[WebRTC] ${purpose} stream received from`, targetUserId);
      if (purpose === "screen") this.onScreenStream?.(targetUserId, s);
      else this.onStream?.(targetUserId, s);
    });

    peer.on("connect", () => {
      console.log(`[WebRTC] ${purpose} connected to peer`, targetUserId);
    });

    peer.on("close", () => {
      map.delete(targetUserId);
      if (purpose === "screen") this.onScreenEnded?.(targetUserId);
      else this.onPeerLeft?.(targetUserId);
    });

    peer.on("error", (err) => {
      console.error(`[WebRTC] ${purpose} peer error with`, targetUserId, err);
      map.delete(targetUserId);
      if (purpose === "screen") this.onScreenEnded?.(targetUserId);
      else this.onPeerLeft?.(targetUserId);
    });

    map.set(targetUserId, peer);
  }

  private _handleSignal = (data: any) => {
    const fromId = data.from_user_id;
    const purpose: "webcam" | "screen" = data.purpose === "screen" ? "screen" : "webcam";
    const key = `${fromId}:${purpose}`;

    // If we haven't joined the call yet, queue webcam signals; screen signals we handle immediately
    // (but only once we're in a call).
    if (!this.localStream) {
      if (!this.pendingSignals.has(key)) this.pendingSignals.set(key, []);
      this.pendingSignals.get(key)!.push(data.signal);
      return;
    }

    const map = purpose === "screen" ? this.screenPeers : this.peers;
    if (!map.has(fromId)) {
      // Remote is initiating — we respond as non-initiator
      this._createPeer(fromId, false, purpose);
    }

    try {
      map.get(fromId)?.signal(data.signal);
    } catch (err) {
      console.error(`[WebRTC] ${purpose} signal error, recreating peer`, fromId, err);
      this._createPeer(fromId, false, purpose);
      try {
        map.get(fromId)?.signal(data.signal);
      } catch {}
    }
  };

  private _handleCallEnd = (data: any) => {
    const fromId = data.from_user_id;
    this.peers.get(fromId)?.destroy();
    this.peers.delete(fromId);
    this.screenPeers.get(fromId)?.destroy();
    this.screenPeers.delete(fromId);
    this.onScreenEnded?.(fromId);
    this.onPeerLeft?.(fromId);

    if (this.peers.size === 0 && this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      this.localScreenStream?.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
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
    this.screenPeers.forEach((p) => p.destroy());
    this.screenPeers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.localScreenStream?.getTracks().forEach((t) => t.stop());
    this.localScreenStream = null;
    this.currentChatId = null;
    this.pendingSignals.clear();
    if (this.gainContext) {
      this.gainContext.close().catch(() => {});
      this.gainContext = null;
      this.gainNode = null;
    }
  }

  // Deprecated — kept for backwards compat if callers still reference it.
  replaceVideoTrack(newTrack: MediaStreamTrack) {
    this.peers.forEach((peer) => {
      const pc = (peer as any)._pc;
      if (!pc) return;
      const sender = pc.getSenders?.()?.find((s: any) => s.track?.kind === "video");
      if (sender) {
        sender.replaceTrack(newTrack).catch((err: any) => {
          console.error("[WebRTC] replaceTrack failed", err);
        });
      }
    });
  }

  // Starts a dedicated screen-share peer connection to every current webcam peer.
  // This runs in addition to the existing webcam stream, so remote peers see both tiles.
  startScreenShare(screenStream: MediaStream) {
    this.localScreenStream = screenStream;
    const targets = Array.from(this.peers.keys());
    for (const uid of targets) {
      this._createPeer(uid, true, "screen");
    }
  }

  stopScreenShare() {
    this.screenPeers.forEach((p) => p.destroy());
    this.screenPeers.clear();
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
