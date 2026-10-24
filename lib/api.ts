// Client-side helpers for talking to the coordination API.
//
// `token` is this tab's secret session token. It's sent as a bearer token and
// never shown to other users; they only see its hash (see lib/auth.ts).
import type { PollResponse, SignalType } from "@/lib/types";

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function join(
  token: string,
  lat: number,
  lng: number,
): Promise<void> {
  await fetch("/api/join", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ lat, lng }),
  });
}

export async function poll(token: string): Promise<PollResponse> {
  const res = await fetch("/api/poll", {
    headers: authHeaders(token),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

export async function sendSignal(
  token: string,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<void> {
  await fetch("/api/signal", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ toId, type, payload }),
  });
}

// Fire-and-forget leave that survives the tab closing. Pass peerId when
// leaving mid-connection so the server can free and notify the partner.
// sendBeacon can't set headers, so the token goes in the body.
export function leave(token: string, peerId?: string): void {
  const body = JSON.stringify({ token, peerId });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", body);
  } else {
    void fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  }
}
