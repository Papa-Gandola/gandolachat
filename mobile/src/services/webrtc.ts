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
  private inited = false;

  onStream: StreamCb | null = null;
  onPeerLeft: LeftCb | null = null;
  onCallEnded: EndedCb | null = null;

  init(myId: number) {
    this.myId = myId;
    if (this.inited) return;
    this.inited = true;
    wsService.on("call_signal", this._onSignal);
    wsService.on("call_end", this._onEnd);
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
    for (const [uid, sigs] of Array.from(this.pending.entries())) {
      if (!this.peers.has(uid)) this._createPeer(uid, false);
      for (const s of sigs) this._applySignal(uid, s);
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
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
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
      const stream = e.streams && e.streams[0];
      if (stream) this.onStream?.(uid, stream);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc.addEventListener("connectionstatechange", () => {
      const st = (pc as unknown as { connectionState?: string }).connectionState;
      if (st === "failed" || st === "closed") {
        this.peers.delete(uid);
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
      } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.warn("[webrtc] applySignal failed", err);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _onEnd = (data: any) => {
    const fromId = data.from_user_id as number;
    this.pending.delete(fromId);
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
  setVideoOff(off: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !off));
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
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.chatId = null;
    this.onCallEnded?.();
  }
}

export const webrtcService = new WebRTCService();
