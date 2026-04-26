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

    // Flush queued signals (webcam AND screen) that arrived before we got our stream.
    // Key format: `${userId}:${purpose}:${role}`
    for (const [key, signals] of Array.from(this.pendingSignals.entries())) {
      const [uidStr, purpose, role] = key.split(":");
      const userId = Number(uidStr);
      let targetMap: Map<number, SimplePeer.Instance>;
      if (purpose === "screen") {
        targetMap = role === "receiver" ? this.screenSendingPeers : this.screenReceivingPeers;
      } else {
        targetMap = this.peers;
      }
      // For receiver-role screens, the sendingPeer should already exist. For others, create non-initiator.
      if (!targetMap.has(userId) && !(purpose === "screen" && role === "receiver")) {
        this._createPeer(userId, false, purpose === "screen" ? "screen" : "webcam");
      }
      for (const sig of signals) {
        try { targetMap.get(userId)?.signal(sig); } catch {}
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

    peer.on("close", () => {
      map.delete(targetUserId);
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
      map.delete(targetUserId);
      if (purpose === "screen") {
        if (!initiator) this.onScreenEnded?.(targetUserId);
      } else {
        this.onPeerLeft?.(targetUserId);
      }
    });

    map.set(targetUserId, peer);
  }

  private _handleSignal = (data: any) => {
    const fromId = data.from_user_id;
    const purpose: "webcam" | "screen" = data.purpose === "screen" ? "screen" : "webcam";
    const remoteRole: "sender" | "receiver" | undefined = data.role;
    console.log(`[WebRTC] signal IN ←`, fromId, `purpose=${data.purpose ?? "<missing>"} role=${remoteRole ?? "-"}`);

    // Queue pre-join signals under a key that also distinguishes role, so
    // flush later routes them correctly.
    const queueKey = `${fromId}:${purpose}:${remoteRole ?? "?"}`;
    if (!this.localStream) {
      if (!this.pendingSignals.has(queueKey)) this.pendingSignals.set(queueKey, []);
      this.pendingSignals.get(queueKey)!.push(data.signal);
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
    }

    if (!map.has(fromId)) {
      if (!createIfMissing) {
        console.warn(`[WebRTC] got ${purpose} signal from ${fromId} but no matching peer (role=${remoteRole})`);
        return;
      }
      this._createPeer(fromId, false, purpose);
    }

    try {
      map.get(fromId)?.signal(data.signal);
    } catch (err) {
      console.error(`[WebRTC] ${purpose} signal error`, fromId, err);
      if (createIfMissing) {
        this._createPeer(fromId, false, purpose);
        try { map.get(fromId)?.signal(data.signal); } catch {}
      }
    }
  };

  private _handleCallEnd = (data: any) => {
    const fromId = data.from_user_id;
    this.peers.get(fromId)?.destroy();
    this.peers.delete(fromId);
    this.screenSendingPeers.get(fromId)?.destroy();
    this.screenSendingPeers.delete(fromId);
    this.screenReceivingPeers.get(fromId)?.destroy();
    this.screenReceivingPeers.delete(fromId);
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
