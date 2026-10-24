"use client";

import { useEffect, useRef, useState } from "react";

const CONTROLS_IDLE_MS = 5_000;

export default function VideoPanel({
  localStream,
  remoteStream,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
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
      className={`absolute inset-0 z-30 bg-black ${controlsVisible ? "" : "cursor-none"}`}
    >
      {/* Remote (full screen) */}
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        className="h-full w-full bg-zinc-900 object-cover"
      />
      {!remoteStream && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
          Waiting for stranger&rsquo;s video…
        </div>
      )}
      {/* Local (picture-in-picture) */}
      <video
        ref={localRef}
        autoPlay
        playsInline
        muted
        className="absolute bottom-4 right-4 h-40 w-28 rounded-lg border border-zinc-700 bg-zinc-800 object-cover"
      />
      {/* Overlay controls */}
      <div
        className={`absolute inset-x-0 bottom-8 z-10 flex justify-center transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
      >
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
