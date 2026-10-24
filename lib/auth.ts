import { createHash } from "node:crypto";

// Each browser holds a random secret token (a v4 UUID) and proves who it is by
// sending it with every request. Other users only ever see the token's SHA-256
// — the public id — so seeing someone's dot never lets you act as them.

const TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PUBLIC_ID_RE = /^[0-9a-f]{64}$/;

export function publicIdFromToken(token: unknown): string | null {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

export function isPublicId(id: unknown): id is string {
  return typeof id === "string" && PUBLIC_ID_RE.test(id);
}

// The caller's public id, from an `Authorization: Bearer <token>` header.
export function callerId(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ")
    ? publicIdFromToken(header.slice("Bearer ".length))
    : null;
}

export function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
