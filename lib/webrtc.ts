import { createVeil, type Veil } from "@/lib/veil";

export type DescType = "offer" | "answer" | "ice";
export type PeerControl =
  | "video-request"
  | "video-accept"
  | "video-decline"
  | "video-end"
  // Mutual reveal: each side says whether it's ready to unblur.
  | "reveal-on"
  | "reveal-off"
  // Mic/camera switched on or off, so the other side can show it.
  | "mic-on"
  | "mic-off"
  | "cam-on"
  | "cam-off";

interface PeerCallbacks {
  onSignal: (type: DescType, payload: string) => void;
  onChat: (text: string) => void;
  onControl: (ctrl: PeerControl) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onChannelOpen: () => void;
  onChannelClose: () => void;
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export class PeerSession {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private localStream: MediaStream | null = null;
  private veil: Veil | null = null;
  // One audio and one video sender for the whole session, added on the first
  // video call and reused by every call after it by swapping tracks in and
  // out. Adding and removing tracks instead renegotiates every time: the SDP
  // grows by two m-lines per call, and the stop/start offers from both sides
  // collide.
  private readonly outgoing = new MediaStream();
  // What we receive, kept across calls for the same reason.
  private readonly remote = new MediaStream();
  private audioSender: RTCRtpSender | null = null;
  private videoSender: RTCRtpSender | null = null;
  private revealed = false;
  private closed = false;
  private readonly cb: PeerCallbacks;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private signalChain: Promise<void> = Promise.resolve();

  constructor(initiator: boolean, cb: PeerCallbacks) {
    this.cb = cb;
    this.polite = !initiator;
    this.pc = new RTCPeerConnection(ICE_CONFIG);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.cb.onSignal("ice", JSON.stringify(candidate));
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.cb.onSignal("offer", JSON.stringify(this.pc.localDescription));
        }
      } finally {
        this.makingOffer = false;
      }
    };

    // Only fires on the first video call; later calls reuse these tracks.
    this.pc.ontrack = ({ track }) => {
      if (!this.remote.getTracks().includes(track)) this.remote.addTrack(track);
      this.cb.onRemoteStream(this.remote);
    };

    this.pc.onconnectionstatechange = () => {
      this.cb.onConnectionState(this.pc.connectionState);
    };

    if (initiator) {
      this.dc = this.pc.createDataChannel("chat");
      this.wireDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel;
        this.wireDataChannel(this.dc);
      };
    }
  }

  private wireDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => this.cb.onChannelOpen();
    // The remote side closing its connection (hang-up, tab close) closes the
    // channel here. Ignore the close we trigger ourselves in close().
    dc.onclose = () => {
      if (!this.closed) this.cb.onChannelClose();
    };
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.t === "chat" && typeof msg.text === "string") {
          this.cb.onChat(msg.text);
        } else if (msg.t === "ctrl" && typeof msg.ctrl === "string") {
          this.cb.onControl(msg.ctrl as PeerControl);
        }
      } catch { }
    };
  }

  // Signals arrive in batches from the poll loop; applying a dedicated processing function to serialize them so an ICE
  // candidate never races ahead of the setRemoteDescription it depends on.
  handleSignal(type: DescType, payload: string): Promise<void> {
    this.signalChain = this.signalChain
      .then(() => this.processSignal(type, payload))
      .catch(() => { });
    return this.signalChain;
  }

  private async processSignal(type: DescType, payload: string) {
    if (this.closed) return;
    const data = JSON.parse(payload);

    if (type === "ice") {
      if (!this.pc.remoteDescription) {
        this.pendingCandidates.push(data);
        return;
      }
      try {
        await this.pc.addIceCandidate(data);
      } catch { }
      return;
    }

    const desc = data as RTCSessionDescriptionInit;
    const offerCollision =
      desc.type === "offer" &&
      (this.makingOffer || this.pc.signalingState !== "stable");
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    await this.pc.setRemoteDescription(desc);
    await this.flushPendingCandidates();
    if (desc.type === "offer") {
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        this.cb.onSignal("answer", JSON.stringify(this.pc.localDescription));
      }
    }
  }

  private async flushPendingCandidates() {
    if (this.pendingCandidates.length === 0) return;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch { }
    }
  }

  sendChat(text: string) {
    this.safeSend({ t: "chat", text });
  }

  sendControl(ctrl: PeerControl) {
    this.safeSend({ t: "ctrl", ctrl });
  }

  private safeSend(obj: unknown) {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(obj));
    }
  }

  // Returns the raw camera stream for the local preview. The stranger gets the
  // veiled copy of the video until setVideoRevealed(true).
  async startVideo(): Promise<MediaStream> {
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      const mic = this.localStream.getAudioTracks()[0] ?? null;
      const camera = this.localStream.getVideoTracks()[0] ?? null;
      this.veil = camera ? createVeil(camera) : null;
      this.audioSender = this.send(this.audioSender, mic);
      this.videoSender = this.send(
        this.videoSender,
        camera && (this.revealed ? camera : this.veil!.track),
      );
      // A repeat call gets no ontrack, so hand back what we already receive.
      if (this.remote.getTracks().length > 0) {
        this.cb.onRemoteStream(this.remote);
      }
    }
    return this.localStream;
  }

  // Start sending `track`: on a new sender the first time (one negotiation),
  // after that by swapping it into the existing sender (none).
  private send(sender: RTCRtpSender | null, track: MediaStreamTrack | null) {
    if (!track) return sender;
    if (!sender) return this.pc.addTrack(track, this.outgoing);
    void sender.replaceTrack(track).catch(() => {});
    return sender;
  }

  // Mute or unmute without renegotiating: a disabled track sends silence or
  // black frames, and the veil (drawn from the camera) goes black with it.
  setTrackEnabled(kind: "audio" | "video", enabled: boolean) {
    for (const track of this.localStream?.getTracks() ?? []) {
      if (track.kind === kind) track.enabled = enabled;
    }
  }

  // Swap between the real camera and the veil without renegotiating.
  setVideoRevealed(revealed: boolean) {
    this.revealed = revealed;
    const camera = this.localStream?.getVideoTracks()[0];
    if (!this.videoSender || !camera || !this.veil) return;
    void this.videoSender
      .replaceTrack(revealed ? camera : this.veil.track)
      .catch(() => {});
  }

  stopVideo() {
    this.revealed = false;
    this.veil?.stop();
    this.veil = null;
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
    // Keep the senders for the next call; just stop sending on them.
    for (const sender of [this.audioSender, this.videoSender]) {
      void sender?.replaceTrack(null).catch(() => {});
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopVideo();
    if (this.dc) {
      try {
        this.dc.close();
      } catch { }
    }
    try {
      this.pc.close();
    } catch { }
  }
}
