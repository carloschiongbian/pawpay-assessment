// How long a presence row survives without a heartbeat (poll). After this the
// dot is treated as offline and removed — implements "dot disappears when the
// user leaves" even if their tab closed without a clean leave.
export const STALE_MS = 15_000;

// Orphan signals (mailbox messages never drained) are cleaned up after this.
export const SIGNAL_TTL_MS = 60_000;

// Arcs for connections started within this window are newly created: clients animate
// them drawing in. A few polls' worth, so nobody misses one. Older arcs are
// shown at rest until their connection ends.
export const ARC_WINDOW_MS = 10_000;

// Client poll interval. Kept here so client + server reason about the same cadence.
export const POLL_INTERVAL_MS = 1_500;
