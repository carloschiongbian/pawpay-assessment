"use client";

import { useEffect, useState } from "react";

export type ConnectingStage = "requesting" | "connecting" | "connected";

// The requesting subtitle is a live countdown instead.
const COPY: Record<ConnectingStage, { title: string; subtitle?: string }> = {
  requesting: { title: "Waiting for them to accept" },
  connecting: {
    title: "Connecting…",
    subtitle: "Setting up a private, peer-to-peer link.",
  },
  connected: {
    title: "Connected",
    subtitle: "Opening chat…",
  },
};

// Covers the map while a connection is being made, so it can't be dragged
// away from the two people (and the arc about to join them). Only Cancel, a
// decline, a failure or success take it down.
export default function ConnectingOverlay({
  stage,
  timeoutMs,
  onCancel,
}: {
  stage: ConnectingStage;
  timeoutMs: number;
  onCancel: () => void;
}) {
  const canCancel = stage !== "connected";

  useEffect(() => {
    if (!canCancel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canCancel, onCancel]);

  const { title, subtitle } = COPY[stage];

  return (
    <div className="absolute inset-0 z-20 cursor-wait bg-linear-to-t from-black/70 via-black/15 to-black/10">
      <div className="absolute inset-x-0 bottom-8 flex justify-center px-4">
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-md cursor-default rounded-2xl bg-white p-5 text-zinc-900 shadow-2xl ring-1 ring-black/5"
        >
          <div className="flex items-center gap-4">
            <Indicator done={stage === "connected"} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-zinc-500">
                {stage === "requesting" ? (
                  <SecondsLeft timeoutMs={timeoutMs} />
                ) : (
                  subtitle
                )}
              </p>
            </div>
            {canCancel && (
              <button
                onClick={onCancel}
                className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:scale-95"
              >
                Cancel
              </button>
            )}
          </div>
          {stage === "requesting" && (
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="pulse-countdown h-full rounded-full bg-emerald-500"
                style={{ animationDuration: `${timeoutMs}ms` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Indicator({ done }: { done: boolean }) {
  if (done) {
    return (
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-lg font-bold text-white">
        ✓
      </span>
    );
  }
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center">
      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40 motion-reduce:animate-none" />
      <span className="size-11 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500 motion-reduce:animate-none" />
    </span>
  );
}

// Mounted fresh with each request, so it always counts down from the top.
function SecondsLeft({ timeoutMs }: { timeoutMs: number }) {
  const [left, setLeft] = useState(Math.round(timeoutMs / 1000));
  useEffect(() => {
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>Request sent · {left}s left</>;
}
