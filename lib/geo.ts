import { createHmac, randomBytes } from "node:crypto";

// Privacy offset: place the dot 1–3 km from the user's real location, never
// at it.
//
// The offset must not be freshly random per session: a random direction
// averages out, so anyone who watches the same user's dot across a few
// sessions could average them back to the real location. Instead the real
// location is snapped to a ~1.1 km grid cell, and the offset is derived from
// the cell with a keyed hash. Everyone in the same cell always lands on the
// same spot, so repeat visits reveal nothing new, and without the secret the
// offset can't be computed and undone.
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
    // Without a fixed secret each server instance picks its own, so offsets
    // change across restarts and instances — weaker against averaging.
    console.warn("LOCATION_PRIVACY_SECRET is not set; using a random one.");
  }
  return fallbackSecret;
}

export function applyPrivacyOffset(
  lat: number,
  lng: number,
): { lat: number; lng: number } {
  // Square-ish cells: longitude steps widen with latitude.
  const row = Math.floor(lat / CELL_DEG);
  const centerLat = (row + 0.5) * CELL_DEG;
  const lngStep =
    CELL_DEG / Math.max(Math.cos((centerLat * Math.PI) / 180), 0.05);
  const col = Math.floor((lng + 180) / lngStep);
  const centerLng = -180 + (col + 0.5) * lngStep;

  const hash = createHmac("sha256", privacySecret())
    .update(`${row}:${col}`)
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
