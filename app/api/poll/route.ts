import type { NextRequest } from "next/server";
import { callerId, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { ARC_WINDOW_MS, STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";
import type { PollResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/poll — Authorization: Bearer <token>. The single endpoint that
// drives the live map. It (1) heartbeats the caller, (2) reaps stale presence
// + orphan signals, (3) returns the filtered online peers, (4) drains this
// user's mailbox, and (5) returns arcs for connections that just started.
export async function GET(request: NextRequest) {
  const id = callerId(request);
  if (!id) return unauthorized();
  // The client polls every 1.5s; leave headroom for retries and slow ticks.
  if (!rateLimit(`poll:${id}`, 20, 10_000)) return tooManyRequests();

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  // 1) Heartbeat — refresh lastSeen for the caller only, so everyone else's
  // row ages out once they stop polling.
  const heartbeat = await prisma.presence.updateMany({
    where: { id },
    data: { lastSeen: new Date(now) },
  });

  // 2) Reap stale presence rows and orphaned signals (independent deletes —
  // no atomicity needed, and avoids transactions over a PgBouncer pooler).
  await prisma.presence.deleteMany({ where: { lastSeen: { lt: staleCutoff } } });
  await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } });
  await prisma.arc.deleteMany({ where: { createdAt: { lt: signalCutoff } } });

  // Only users on the map may see who else is: anyone else must join first,
  // which is rate limited.
  if (heartbeat.count === 0) {
    const response: PollResponse = {
      present: false,
      peers: [],
      signals: [],
      arcs: [],
    };
    return Response.json(response);
  }

  // 3) Online peers, excluding self.
  const peers = await prisma.presence.findMany({
    where: {
      id: { not: id },
      lastSeen: { gte: staleCutoff },
    },
    select: { id: true, lat: true, lng: true, busy: true },
  });

  // 4) Drain this user's mailbox: read, then delete exactly what we read so a
  // concurrently-inserted signal is never lost.
  const inbox = await prisma.signal.findMany({
    where: { toId: id },
    orderBy: { createdAt: "asc" },
  });
  if (inbox.length > 0) {
    await prisma.signal.deleteMany({
      where: { id: { in: inbox.map((s) => s.id) } },
    });
  }

  // 5) Connections started anywhere in the last few seconds, for the globe.
  const arcs = await prisma.arc.findMany({
    where: { createdAt: { gte: new Date(now - ARC_WINDOW_MS) } },
    orderBy: { createdAt: "asc" },
  });

  const response: PollResponse = {
    // False if our row was reaped (e.g. a throttled background tab missed
    // heartbeats); the client re-joins to get back on the map.
    present: heartbeat.count > 0,
    peers: peers.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.busy,
    })),
    signals: inbox.map((s) => ({
      id: s.id,
      fromId: s.fromId,
      toId: s.toId,
      type: s.type as PollResponse["signals"][number]["type"],
      payload: s.payload,
      createdAt: s.createdAt.toISOString(),
    })),
    arcs: arcs.map((a) => ({
      id: a.id,
      from: [a.fromLng, a.fromLat],
      to: [a.toLng, a.toLat],
    })),
  };

  return Response.json(response);
}
