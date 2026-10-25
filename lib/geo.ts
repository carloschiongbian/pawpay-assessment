import { createHmac, randomBytes } from "node:crypto";

// Privacy offset: place the dot 1–3 km from the user's real location, never
// at it, and somewhere new each session (docs/requirements.md).
//
// A fresh random offset around the *real* location would average out: watch
// one person's dot over enough sessions and the mean is where they are. So the
// location is first snapped to a ~1.1 km grid cell, and the offset is taken
// from the cell's center. Averaging many sessions then only recovers the cell,
// never the exact spot.
//
// The offset comes from a keyed hash of the cell and the session id: a new
// session (new token, so new id) lands somewhere new, the same session always
// lands in the same place (e.g. when it re-joins), and without the secret
// nobody can compute an offset from a public id and undo it.
//
// Offsetting from the cell center (≤ ~0.79 km from the user) by 1.8–2.2 km
// keeps the dot 1–3 km from the user's real position.

const KM_PER_DEG_LAT = 111.32;
const CELL_DEG = 0.01; // ~1.1 km of latitude
const MIN_OFFSET_KM = 1.8;
const OFFSET_RANGE_KM = 0.4;

let warnedNoSecret = false;
const fallbackSecret = randomBytes(32);

function privacySecret(): Buffer | string {
  const secret = process.env.LOCATION_PRIVACY_SECRET;
  if (secret) return secret;
  if (!warnedNoSecret) {
    warnedNoSecret = true;
    // Without a fixed secret each server instance picks its own, so a
    // session's dot can jump if a request lands on another instance.
    console.warn("LOCATION_PRIVACY_SECRET is not set; using a random one.");
  }
  return fallbackSecret;
}

export function applyPrivacyOffset(
  lat: number,
  lng: number,
  sessionId: string,
): { lat: number; lng: number } {
  // Square-ish cells: longitude steps widen with latitude.
  const row = Math.floor(lat / CELL_DEG);
  const centerLat = (row + 0.5) * CELL_DEG;
  const lngStep =
    CELL_DEG / Math.max(Math.cos((centerLat * Math.PI) / 180), 0.05);
  const col = Math.floor((lng + 180) / lngStep);
  const centerLng = -180 + (col + 0.5) * lngStep;

  const hash = createHmac("sha256", privacySecret())
    .update(`${row}:${col}:${sessionId}`)
    .digest();
  const distanceKm =
    MIN_OFFSET_KM + (hash.readUInt32BE(0) / 2 ** 32) * OFFSET_RANGE_KM;
  const bearing = (hash.readUInt32BE(4) / 2 ** 32) * 2 * Math.PI;

  const dLat = (distanceKm * Math.cos(bearing)) / KM_PER_DEG_LAT;
  const latRad = (centerLat * Math.PI) / 180;
  const dLng =
    (distanceKm * Math.sin(bearing)) /
    (KM_PER_DEG_LAT * Math.cos(latRad) || KM_PER_DEG_LAT);

  return {
    lat: clamp(centerLat + dLat, -90, 90),
    lng: wrapLng(centerLng + dLng),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function wrapLng(lng: number): number {
  // Keep longitude in [-180, 180].
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
