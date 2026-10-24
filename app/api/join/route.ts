import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { callerId, unauthorized } from "@/lib/auth";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — Authorization: Bearer <token>, body { lat, lng } (raw
// coords). Applies a 1–3 km privacy offset and upserts the presence row. Raw
// coordinates are never stored.
export async function POST(request: NextRequest) {
  const id = callerId(request);
  if (!id) return unauthorized();
  // Joining is what grants access to everyone's dots, so cap it per IP.
  if (!rateLimit(`join:${clientIp(request)}`, 20, 60_000)) {
    return tooManyRequests();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { lat, lng } = (body ?? {}) as Record<string, unknown>;

  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const offset = applyPrivacyOffset(lat as number, lng as number);

  await prisma.presence.upsert({
    where: { id },
    create: {
      id,
      lat: offset.lat,
      lng: offset.lng,
      busy: false,
      lastSeen: new Date(),
    },
    update: {
      lat: offset.lat,
      lng: offset.lng,
      lastSeen: new Date(),
    },
  });

  return Response.json({ ok: true });
}
