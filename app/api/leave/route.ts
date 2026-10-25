import type { NextRequest } from "next/server";
import { isPublicId, publicIdFromToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { token, peerId? }. Removes the presence row and any
// pending signals to/from this user. If they left mid-connection, peerId names
// the partner, who is freed and sent an "end". Called via navigator.sendBeacon
// on tab close, which can't set headers — so the token rides in the body, and
// the body may arrive as text. Parse defensively.
export async function POST(request: NextRequest) {
  if (!rateLimit(`leave:${clientIp(request)}`, 30, 60_000)) {
    return tooManyRequests();
  }

  let token: unknown;
  let peerId: unknown;
  try {
    const text = await request.text();
    ({ token, peerId } = text ? (JSON.parse(text) ?? {}) : {});
  } catch {
    token = undefined;
  }

  const id = publicIdFromToken(token);
  if (!id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });
  await prisma.arc.deleteMany({ where: { OR: [{ aId: id }, { bId: id }] } });

  // Free the partner and tell them we're gone. Runs after the signal cleanup
  // above so this "end" isn't swept up with our other outgoing signals.
  if (isPublicId(peerId) && peerId !== id) {
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
