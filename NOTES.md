# Notes

## Phase 4 — Make it better

Two small features that tell one story: **life on the globe, consent in the call.**

### Connection arcs (alive)

- **What:** when someone accepts a connection, a glowing arc draws itself across
  the globe from requester to accepter, on **everyone's** map. A comet head leads
  it, both ends ripple, then it fades.
- **Why:** a map of dots looks static. Arcs make the world visibly *pulse* with
  conversations, even when you're not in one, and show that real people are
  connecting right now.
- **How:** an accept stores an `Arc` row holding only the two (already
  privacy-offset) dot positions, with no session ids. `poll` returns arcs from the
  last 10s and reaps them after a minute. The client draws each new arc once, as
  short-lived Mapbox layers along a great circle (`line-gradient` +
  `line-trim-offset`). Respects `prefers-reduced-motion`.
- **Abuse/privacy:** the endpoints are dots that are already public. Accepts share
  the request rate limit (6/min), so nobody can spam arcs.

### Mutual-reveal video (safe)

- **What:** video starts blurred for both people. Each taps **Reveal**, and the
  picture only sharpens once *both* have. Either person can blur again at any
  time, which blurs it for both.
- **Why:** the defining failure of random video chat is unwanted exposure; Omegle
  shut down largely over abuse. Consent should be built into the medium, not left
  to a report button after the harm is done.
- **How (two layers):**
  - **Sender side:** the camera is turned into a "veil" on-device. Each frame is
    shrunk to 16px wide and scaled back up on a canvas, and *that* is the track
    that gets sent. `replaceTrack` swaps in the real camera only once both have
    opted in, with no renegotiation. **Your real image never leaves your device
    before then.**
  - **Receiver side:** incoming video is also blurred until both opt in, so a
    modified client that skips the veil still can't flash anyone.
  - **Verified** with two headless browsers. Before the reveal, received frames
    had **0** hard edges; after it, ~920. It drops back to 0 the moment either
    side blurs.
- **Trade-offs:** audio isn't gated, so you can keep talking while blurred. A
  modified client can still unblur what *it* receives: the veil protects the
  sender, and the receiver-side blur protects the receiver.

### Next, with more time

- **Arcs:** lift them off the surface as 3D curves, and add a subtle "connections
  in the last hour" heartbeat.
- **Reveal:** an on-device nudity classifier that re-veils automatically
  regardless of reveal state, plus an optional "audio first" stage.
- **Server:** a connections table so accept/decline/end are checked against
  real pending requests.
