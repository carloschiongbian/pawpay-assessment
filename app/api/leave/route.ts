import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { id, peerId? }. Removes the presence row and any
// pending signals to/from this user. If they left mid-connection, peerId names
// the partner, who is freed and sent an "end". Called via navigator.sendBeacon
// on tab close, so the body may arrive as text — parse defensively.
export async function POST(request: NextRequest) {
  let id: unknown;
  let peerId: unknown;
  try {
    const text = await request.text();
    ({ id, peerId } = text ? (JSON.parse(text) ?? {}) : {});
  } catch {
    id = undefined;
  }

  if (typeof id !== "string" || !id) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  // Free the partner and tell them we're gone. Runs after the signal cleanup
  // above so this "end" isn't swept up with our other outgoing signals.
  if (typeof peerId === "string" && peerId) {
    await prisma.presence.updateMany({
      where: { id: peerId },
      data: { busy: false },
    });
    await prisma.signal.create({
      data: { fromId: id, toId: peerId, type: "end", payload: null },
    });
  }

  return Response.json({ ok: true });
}
