"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const INPUT_MAX_HEIGHT = 128;

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
}

export default function ChatPanel({
  open,
  messages,
  connected,
  videoBusy,
  onSend,
  onStartVideo,
  onEnd,
}: {
  open: boolean;
  messages: ChatMessage[];
  connected: boolean;
  videoBusy: boolean;
  onSend: (text: string) => void;
  onStartVideo: () => void;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The drawer stays mounted so it can slide out; drop any unsent draft when
  // it closes so it doesn't carry over to the next stranger.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setDraft("");
  }

  useEffect(() => {
    // Scroll only the message list. scrollIntoView would also scroll the
    // page's ancestors, dragging the off-screen drawer into view.
    const list = listRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [draft]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div
      inert={!open}
      aria-hidden={!open}
      className={`absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? "translate-x-0" : "translate-x-full"
        }`}
    >
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <p className="font-semibold">Stranger</p>
          <p className="text-xs text-zinc-500">
            {!open ? "Disconnected" : connected ? "Connected" : "Connecting…"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onStartVideo}
            disabled={!connected || videoBusy}
            className="rounded-full border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500 disabled:opacity-40"
          >
            Video
          </button>
          <button
            onClick={onEnd}
            className="rounded-full bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-400"
          >
            End
          </button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-zinc-500">
            Say hello. Messages are peer-to-peer and never stored.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.mine ? "justify-end" : "justify-start"}`}
          >
            <span
              className={`max-w-[80%] whitespace-pre-wrap wrap-anywhere rounded-2xl px-3 py-2 text-sm ${m.mine
                  ? "bg-emerald-400 text-zinc-950"
                  : "bg-zinc-800 text-zinc-100"
                }`}
            >
              {m.text}
            </span>
          </div>
        ))}
      </div>

      <form
        onSubmit={submit}
        className="flex items-end gap-2 border-t border-zinc-800 p-3"
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={connected ? "Type a message…" : "Connecting…"}
          disabled={!connected}
          style={{ maxHeight: INPUT_MAX_HEIGHT }}
          className="flex-1 resize-none overflow-y-auto rounded-2xl [scrollbar-color:var(--color-zinc-700)_transparent] scrollbar-thin bg-zinc-900 px-4 py-2 text-sm leading-5 outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-emerald-400 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
