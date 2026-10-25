"use client";

import { useEffect, useRef, useState } from "react";

const CONTROLS_IDLE_MS = 5_000;

// Status line and button label for each side of the mutual reveal.
function revealCopy(mine: boolean, theirs: boolean) {
  if (mine && theirs) return { status: "Revealed", action: "Blur" };
  if (mine) return { status: "Waiting for them to reveal…", action: "Cancel" };
  if (theirs) return { status: "They're ready to reveal", action: "Reveal" };
  return { status: "Video is blurred", action: "Reveal" };
}

type Media = { mic: boolean; cam: boolean };

// Mic and camera icons; `off` adds the slash.
function MicIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

function CamIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

export default function VideoPanel({
  localStream,
  remoteStream,
  reveal,
  onToggleReveal,
  myMedia,
  theirMedia,
  onToggleMic,
  onToggleCam,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  reveal: { mine: boolean; theirs: boolean };
  onToggleReveal: () => void;
  myMedia: Media;
  theirMedia: Media;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onEnd: () => void;
}) {
  const revealed = reveal.mine && reveal.theirs;
  const copy = revealCopy(reveal.mine, reveal.theirs);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  // The remote stream is reused across calls, so it can exist before the
  // stranger is sending again; wait for an actual frame.
  const [hasFrames, setHasFrames] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Show the controls on any pointer activity; hide them after 5s of stillness.
  function showControls() {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(
      () => setControlsVisible(false),
      CONTROLS_IDLE_MS,
    );
  }

  // Controls start visible; schedule the first auto-hide on mount.
  useEffect(() => {
    hideTimer.current = setTimeout(
      () => setControlsVisible(false),
      CONTROLS_IDLE_MS,
    );
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <div
      onPointerMove={showControls}
      onPointerDown={showControls}
      className={`absolute inset-0 z-30 overflow-hidden bg-black ${controlsVisible ? "" : "cursor-none"}`}
    >
      {/* Remote (full screen). Their client already sends a blurred feed until
          you've both revealed; blurring here too protects you from a modified
          client that doesn't. */}
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        onLoadedData={() => setHasFrames(true)}
        className={`h-full w-full bg-zinc-900 object-cover transition-[filter,scale] duration-700 ${revealed ? "" : "scale-110 blur-2xl"}`}
      />

      {/* Mutual reveal — always visible, it's the call's state. */}
      <div className="absolute left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-900/80 py-1.5 pl-4 pr-1.5 text-sm text-zinc-100 shadow-lg backdrop-blur">
        <span>
          {revealed ? "👀" : "🔒"} {copy.status}
        </span>
        <button
          onClick={onToggleReveal}
          className={`rounded-full px-4 py-1.5 font-medium ${reveal.mine
            ? "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
            : "bg-emerald-400 text-zinc-950 hover:bg-emerald-300"
            }`}
        >
          {copy.action}
        </button>
      </div>
      {!theirMedia.cam ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900 text-zinc-400">
          <CamIcon off />
          <span className="text-sm">Their camera is off</span>
        </div>
      ) : (
        (!remoteStream || !hasFrames) && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
            Waiting for stranger&rsquo;s video…
          </div>
        )
      )}
      {!theirMedia.mic && (
        <div className="absolute left-6 top-6 z-10 flex items-center gap-1.5 rounded-full bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-200 shadow-lg backdrop-blur">
          <MicIcon off />
          Muted
        </div>
      )}
      {/* Local (picture-in-picture) */}
      <div className="absolute bottom-4 right-4 h-40 w-28 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800">
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        {!myMedia.cam && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-800 text-zinc-400">
            <CamIcon off />
          </div>
        )}
        {!revealed && myMedia.cam && (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-[10px] text-zinc-300">
            Blurred for them
          </span>
        )}
      </div>
      {/* Overlay controls */}
      <div
        className={`absolute inset-x-0 bottom-8 z-10 flex items-center justify-center gap-3 transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
      >
        <button
          onClick={onToggleMic}
          aria-pressed={!myMedia.mic}
          aria-label={myMedia.mic ? "Mute microphone" : "Unmute microphone"}
          title={myMedia.mic ? "Mute" : "Unmute"}
          className={`flex size-12 items-center justify-center rounded-full shadow-lg transition active:scale-95 ${myMedia.mic
            ? "bg-zinc-800/90 text-white hover:bg-zinc-700"
            : "bg-white text-zinc-900 hover:bg-zinc-200"
            }`}
        >
          <MicIcon off={!myMedia.mic} />
        </button>
        <button
          onClick={onToggleCam}
          aria-pressed={!myMedia.cam}
          aria-label={myMedia.cam ? "Turn camera off" : "Turn camera on"}
          title={myMedia.cam ? "Camera off" : "Camera on"}
          className={`flex size-12 items-center justify-center rounded-full shadow-lg transition active:scale-95 ${myMedia.cam
            ? "bg-zinc-800/90 text-white hover:bg-zinc-700"
            : "bg-white text-zinc-900 hover:bg-zinc-200"
            }`}
        >
          <CamIcon off={!myMedia.cam} />
        </button>
        <button
          onClick={onEnd}
          className="rounded-full bg-red-500 px-8 py-3 font-semibold text-white shadow-lg hover:bg-red-400"
        >
          End video
        </button>
      </div>
    </div>
  );
}
