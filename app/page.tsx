"use client";

import { useEffect, useRef, useState } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ConnectingOverlay from "./components/ConnectingOverlay";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import { join, leave, poll, sendSignal } from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import {
  type ArcEvent,
  type DeclineReason,
  type PeerDot,
  type SignalMsg,
} from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

// Mutual reveal: video stays blurred until both people opt in.
type Reveal = { mine: boolean; theirs: boolean };
const NOT_REVEALED: Reveal = { mine: false, theirs: false };

const REQUEST_TIMEOUT_MS = 30_000;
// Accepted but the peer-to-peer link never came up (e.g. their side was torn
// down by a stale "end"); give up rather than hold the overlay forever.
const CONNECT_TIMEOUT_MS = 20_000;

// The chat opens once our arc has landed on the map. If the arc is missed
// (e.g. a slow poll), don't keep a connected user waiting longer than this.
const ARC_FALLBACK_MS = 4_000;

const DECLINE_NOTICES: Record<string, string> = {
  busy: "User is busy.",
  offline: "User is offline.",
} satisfies Record<DeclineReason, string>;

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  // Secret: proves who we are to the API. Others only ever see its hash.
  const [sessionToken] = useState(() => crypto.randomUUID());
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [arcs, setArcs] = useState<ArcEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
    // Every new video call starts blurred again.
    if (v === "none") setReveal(NOT_REVEALED);
  };

  const peerRef = useRef<PeerSession | null>(null);
  const [arcLanded, setArcLanded] = useState(false);

  const [reveal, _setReveal] = useState<Reveal>(NOT_REVEALED);
  const revealRef = useRef<Reveal>(reveal);
  const setReveal = (r: Reveal) => {
    revealRef.current = r;
    _setReveal(r);
    // The real camera only goes out once both sides have opted in.
    peerRef.current?.setVideoRevealed(r.mine && r.theirs);
  };
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  function teardown(message?: string) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    if (connectTimer.current) clearTimeout(connectTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  function startPeer(peerId: string, initiator: boolean) {
    // Cleared here rather than in teardown so the previous chat stays visible
    // while the drawer slides out.
    setMessages([]);
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void sendSignal(sessionToken, peerId, type, payload);
      },
      onChat: (text) => addMessage(false, text),
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (state === "failed") {
          void sendSignal(sessionToken, peerId, "end");
          teardown("Connection failed (network).");
        }
      },
      onChannelOpen: () => {
        setConn({ kind: "connected", peerId });
      },
      onChannelClose: () => {
        // The peer may have vanished without delivering an "end" (e.g. tab
        // closed), so send one ourselves to free both busy flags.
        void sendSignal(sessionToken, peerId, "end");
        teardown("Stranger disconnected.");
      },
    });
    peerRef.current = ps;
    connectTimer.current = setTimeout(() => {
      if (peerRef.current === ps && connRef.current.kind === "connecting") {
        void sendSignal(sessionToken, peerId, "end");
        teardown("Couldn't connect.");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "reveal-on":
      case "reveal-off":
        if (videoRef.current !== "none") {
          setReveal({ ...revealRef.current, theirs: ctrl === "reveal-on" });
        }
        break;
      case "video-end":
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    // Autodecline if the peer is busy.
    if (peers.find((p) => p.id === peerId)?.busy) {
      showNotice(DECLINE_NOTICES.busy);
      return;
    }
    // Reset before the accept: a poll can deliver our arc ahead of it.
    setArcLanded(false);
    setConn({ kind: "requesting", peerId });
    void sendSignal(sessionToken, peerId, "request");
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void sendSignal(sessionToken, peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void sendSignal(sessionToken, connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    setArcLanded(false);
    startPeer(peerId, false);
    void sendSignal(sessionToken, peerId, "accept");
    setConn({ kind: "connecting", peerId });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void sendSignal(sessionToken, connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void sendSignal(sessionToken, c.peerId, "end");
    }
    teardown();
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function toggleReveal() {
    const mine = !revealRef.current.mine;
    setReveal({ ...revealRef.current, mine });
    peerRef.current?.sendControl(mine ? "reveal-on" : "reveal-off");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          void sendSignal(
            sessionToken,
            sig.fromId,
            "decline",
            "busy" satisfies DeclineReason,
          );
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
        } else {
          // We cancelled or timed out before this accept arrived. The server
          // may have applied our "end" before their "accept", leaving both of
          // us busy, so end it again to free the flags and close their side.
          void sendSignal(sessionToken, sig.fromId, "end");
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          teardown(DECLINE_NOTICES[sig.payload ?? ""] ?? "Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          void peerRef.current.handleSignal(
            sig.type as DescType,
            sig.payload ?? "",
          );
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (
          (c.kind === "incoming" ||
            c.kind === "connecting" ||
            c.kind === "connected") &&
          c.peerId === sig.fromId
        ) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  // Open the chat even if our arc never shows up.
  useEffect(() => {
    if (conn.kind !== "connected" || arcLanded) return;
    const timer = setTimeout(() => setArcLanded(true), ARC_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [conn.kind, arcLanded]);

  const processSignalRef = useRef(processSignal);
  useEffect(() => {
    processSignalRef.current = processSignal;
  });

  useEffect(() => {
    if (phase !== "live" || !sessionToken) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(sessionToken);
        if (!active) return;
        if (!data.present && myLocation) {
          await join(sessionToken, myLocation.lat, myLocation.lng);
        }
        setPeers(data.peers);
        setArcs(data.arcs);
        for (const s of data.signals) processSignalRef.current(s);
      } catch { }
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, sessionToken, myLocation]);

  useEffect(() => {
    if (!sessionToken || phase !== "live") return;
    const onLeave = () => {
      const c = connRef.current;
      leave(sessionToken, c.kind === "idle" ? undefined : c.peerId);
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [sessionToken, phase]);

  async function handleReady(lat: number, lng: number) {
    setMyLocation({ lat, lng });
    await join(sessionToken, lat, lng);
    setPhase("live");
  }

  if (phase === "gate") {
    return <EntryGate onReady={handleReady} />;
  }

  // Chat opens only once the link is up and the arc between us has landed;
  // until then the connecting overlay holds the map still.
  const chatOpen = conn.kind === "connected" && arcLanded;
  const connectingStage =
    conn.kind === "requesting" || conn.kind === "connecting"
      ? conn.kind
      : conn.kind === "connected" && !arcLanded
        ? "connected"
        : null;

  return (
    <main className="fixed inset-0 overflow-clip">
      <WorldMap
        peers={peers}
        arcs={arcs}
        me={myLocation}
        onPeerClick={requestConnection}
        canConnect={conn.kind === "idle"}
        focusId={conn.kind === "idle" ? null : conn.peerId}
        drawerOpen={chatOpen}
        onFocusArcLanded={() => setArcLanded(true)}
      />

      {connectingStage && (
        <ConnectingOverlay
          stage={connectingStage}
          timeoutMs={REQUEST_TIMEOUT_MS}
          onCancel={
            connectingStage === "requesting" ? cancelRequest : endConnection
          }
        />
      )}

      {notice && (
        <div
          key={notice}
          role="status"
          aria-live="polite"
          className="pulse-toast absolute left-1/2 top-4 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-lg ring-1 ring-black/5"
        >
          <span className="size-2 shrink-0 rounded-full bg-amber-500" />
          {notice}
        </div>
      )}

      {conn.kind === "incoming" && (
        <ConnectionPrompt
          title="A stranger wants to connect"
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      <ChatPanel
        open={chatOpen}
        messages={messages}
        connected={conn.kind === "connected"}
        videoBusy={video !== "none"}
        onSend={(text) => {
          peerRef.current?.sendChat(text);
          addMessage(true, text);
        }}
        onStartVideo={startVideoRequest}
        onEnd={endConnection}
      />

      {video === "requesting" && (
        <div className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-zinc-800/90 px-4 py-2 text-sm text-zinc-100 shadow-lg backdrop-blur">
          Waiting for stranger to accept video…
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          title="Start video call?"
          subtitle="Video is blurred by default and can be switched on and off at any time."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          reveal={reveal}
          onToggleReveal={toggleReveal}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}
