// Shared types across client + API.

// Signal mailbox message types.
export type SignalType =
  | "request" // connection request (tap a dot)
  | "accept" // recipient accepted
  | "decline" // recipient declined (or auto-declined while busy)
  | "offer" // WebRTC SDP offer
  | "answer" // WebRTC SDP answer
  | "ice" // WebRTC ICE candidate
  | "end"; // hang up / leave the connection

// Payload of an automatic "decline". A manual decline has no payload.
export type DeclineReason =
  | "busy" // recipient is already in (or being asked into) a connection
  | "offline"; // recipient left before the request arrived

export interface PeerDot {
  id: string;
  lat: number;
  lng: number;
  busy: boolean;
}

// A connection that just started somewhere, drawn as an arc on the globe.
// Points are [lng, lat] of the two (privacy-offset) dots.
export interface ArcEvent {
  id: string;
  from: [number, number];
  to: [number, number];
}

export interface SignalMsg {
  id: string;
  fromId: string;
  toId: string;
  type: SignalType;
  payload: string | null;
  createdAt: string;
}

export interface PollResponse {
  present: boolean;
  peers: PeerDot[];
  signals: SignalMsg[];
  arcs: ArcEvent[];
}
