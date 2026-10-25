import type { NextRequest } from "next/server";
import { callerId, isPublicId, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";
import type { DeclineReason, SignalType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const DECLINE_REASONS: DeclineReason[] = ["busy", "offline"];

const MAX_PAYLOAD = 16 * 1024; // SDP is a few KB, an ICE candidate ~300 bytes.

// Undelivered signals a recipient can have waiting, so nobody can flood a
// mailbox (or the table) faster than its owner drains it.
const MAX_INBOX = 100;

// POST /api/signal — Authorization: Bearer <token>, body { toId, type, payload? }
// Drops one message into the recipient's mailbox. Also manages the `busy`
// flag so a user can only be in one connection at a time.
export async function POST(request: NextRequest) {
  const fromId = callerId(request);
  if (!fromId) return unauthorized();
  // ICE candidates arrive in bursts; requests are what strangers see, so they
  // get a much tighter limit.
  if (!rateLimit(`signal:${fromId}`, 100, 10_000)) return tooManyRequests();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { toId, type, payload } = (body ?? {}) as Record<string, unknown>;

  if (!isPublicId(toId) || toId === fromId) {
    return Response.json({ error: "invalid toId" }, { status: 400 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  const signalType = type as SignalType;
  if (!isValidPayload(signalType, payload)) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  const payloadStr = typeof payload === "string" ? payload : null;

  // Requests reach strangers and accepts draw an arc on every globe, so both
  // share a tight per-user budget.
  if (
    (signalType === "request" || signalType === "accept") &&
    !rateLimit(`connect:${fromId}`, 6, 60_000)
  ) {
    return tooManyRequests();
  }

  // Only users on the map can signal.
  const sender = await prisma.presence.findUnique({
    where: { id: fromId },
    select: { lat: true, lng: true },
  });
  if (!sender) return unauthorized();

  const target = await prisma.presence.findUnique({
    where: { id: toId },
    select: { busy: true, lat: true, lng: true },
  });
  if (!target) {
    // Target went offline — tell a requester it was declined; anything else
    // has nobody to deliver to.
    if (signalType === "request") {
      await sendDecline(toId, fromId, "offline");
      return Response.json({ ok: true, autoDeclined: true });
    }
    return Response.json({ error: "recipient offline" }, { status: 404 });
  }

  // Enforce "one active connection at a time": if the target is already busy,
  // auto-decline the request instead of delivering it.
  if (signalType === "request" && target.busy) {
    await sendDecline(toId, fromId, "busy");
    return Response.json({ ok: true, autoDeclined: true });
  }

  const pending = await prisma.signal.count({ where: { toId } });
  if (pending >= MAX_INBOX) return tooManyRequests();

  // Busy transitions:
  // - accept: the connection is now active → mark BOTH peers busy.
  // - decline/end: free both peers.
  // - decline with reason "busy": the decliner is in another connection, so
  //   only free the requester.
  if (signalType === "accept") {
    await prisma.presence.updateMany({
      where: { id: { in: [fromId, toId] } },
      data: { busy: true },
    });
    // Light up the new connection on everyone's globe, from requester to
    // accepter, for as long as it lasts.
    await deleteArcs([fromId, toId]);
    await prisma.arc.create({
      data: {
        aId: toId,
        bId: fromId,
        fromLat: target.lat,
        fromLng: target.lng,
        toLat: sender.lat,
        toLng: sender.lng,
      },
    });
  } else if (signalType === "decline" && payloadStr === "busy") {
    await prisma.presence.updateMany({
      where: { id: toId },
      data: { busy: false },
    });
  } else if (signalType === "decline" || signalType === "end") {
    await prisma.presence.updateMany({
      where: { id: { in: [fromId, toId] } },
      data: { busy: false },
    });
    await deleteArcs([fromId, toId]);
  }

  await prisma.signal.create({
    data: { fromId, toId, type: signalType, payload: payloadStr },
  });

  return Response.json({ ok: true });
}

// WebRTC descriptions carry a bounded string; a decline may carry its reason;
// everything else carries nothing.
function isValidPayload(type: SignalType, payload: unknown): boolean {
  switch (type) {
    case "offer":
    case "answer":
    case "ice":
      return (
        typeof payload === "string" &&
        payload.length > 0 &&
        payload.length <= MAX_PAYLOAD
      );
    case "decline":
      return (
        payload == null || DECLINE_REASONS.includes(payload as DeclineReason)
      );
    default:
      return payload == null;
  }
}

// Helper: remove the arc of any connection these users are in.
async function deleteArcs(ids: string[]) {
  await prisma.arc.deleteMany({
    where: { OR: [{ aId: { in: ids } }, { bId: { in: ids } }] },
  });
}

// Helper: deliver an auto-decline from `target` back to `initiator`, with the
// reason in the payload so the initiator can tell it apart from a manual one.
async function sendDecline(
  targetId: string,
  initiatorId: string,
  reason: DeclineReason,
) {
  await prisma.signal.create({
    data: {
      fromId: targetId,
      toId: initiatorId,
      type: "decline",
      payload: reason,
    },
  });
}
