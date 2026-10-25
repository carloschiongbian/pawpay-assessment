# Notes

## Phase 1 — Make it run

Found by running two browsers side by side and testing each flow, then reading
`lib/webrtc.ts`, `app/page.tsx` and the API routes whenever something stalled.

| Bug | Cause | Fix |
| --- | --- | --- |
| **Chat messages never arrived** | Sender tagged messages `t: "msg"`; receiver listened for `t: "chat"`. | Matched the tags (`a936de0`). |
| **Users stuck "busy" after a call** | `/api/signal` only cleared `busy` on `decline`, not `end`, so every later request was auto-declined. | Clear both flags on `end` too (`e512511`). A failed network connection now sends `end` (`f6ce38b`). |
| **Connecting hung or failed at random** | Poll delivers signals in batches; handlers ran concurrently, so ICE candidates raced ahead of `setRemoteDescription`. Queued candidates were also flushed *before* the remote description was set. | Serialize signal handling with a promise chain; flush candidates after the remote description (`91fc0aa`). |
| **Partner left stranded** | A closed tab or dropped connection sent no `end`; `/api/leave` left the partner `busy`. | Data-channel close triggers `end` (`aa0c13d`). The leave beacon includes the peer and drops an `end` in their inbox (`1162ab6`). |
| **Accept/cancel race** | Requester's `end` (cancel/timeout) could land before the recipient's `accept`, leaving both busy with no connection. | Requester replies `end` to an accept it no longer expects (`f49e536`). |
| **Confusing / wrong declines** | Auto-declines looked like manual ones, and a "busy" auto-decline freed the decliner mid-call. | `DeclineReason` (`busy` / `offline`) shown to the requester; a busy decline frees only the requester (`d4f15cb`). |
| **Ghost dots** | The poll heartbeat ran `updateMany({ where: {} })`, refreshing *everyone's* `lastSeen`, so nobody ever aged out. | Heartbeat only the caller (`0d794cd`). Poll returns `present`, and a reaped client (e.g. a throttled background tab) re-joins (`4d75c2d`). |
| **Build/lint** | Install and Prisma lint errors. | `e2266be`. |

## Phase 2 — UI/UX

- **End video button:** an overlay "End video" control that auto-hides after
  5s of stillness and returns on any pointer activity, so it never covers the
  call (`ecf7dbc`).
- **Chat drawer:** the chat slides in from the right only once a connection is
  ready, and slides out on End. It stays mounted, so it animates both ways,
  with `inert` / `aria-hidden` when closed and `motion-reduce` respected. The
  unsent draft clears on close. Auto-scroll only moves the message list, so it
  can't pull the hidden drawer on screen (`264f4f2`).
- **Avatars instead of dots:** each user is a deterministic Nice Avatar
  (`genConfig(id)`), 45px with a white ring. Hover shows the name, busy users
  are dimmed, and tapping one flies the map to it. Built for speed:
  - libraries are preloaded at module load, with a Mapbox `preconnect`;
  - avatar configs are cached;
  - markers are reconciled by id, so a marker only changes when its data does;
  - each avatar has CSS `contain: strict`.

  Hover scales an inner button, not the marker, so it doesn't fight Mapbox's
  transform (`2bbed78`).
- **Globe colour:** bright blue water, green land and landuse, white labels,
  and a blue atmosphere with stars, so the default dark style is no longer
  grey on grey (`bb63a38`).
- **Map controls:** a minimal top-right stack with a live "N online" count and
  a "📍 My location" button. It's light on the dark map, so it stands out
  without being loud.

## Phase 3 — Security

1. **Critical: identity spoofing.** The session id was both public (shown on
   the map) and the only credential. Anyone could poll as another user to read
   their signals (SDP and ICE, which exposes their IP), accept or end their
   calls, or kick them off the map.
   - **Fix:** the client holds a secret v4-UUID token, sent as
     `Authorization: Bearer`, or in the body for the `sendBeacon` leave.
   - Others only ever see `SHA-256(token)`, so a public id can't be turned
     back into a token.
2. **Critical/High: vulnerable dependencies.** Next.js had known advisories,
   one critical. Upgraded and pinned `next` and `eslint-config-next` 16.4.3;
   `npm audit` reports 0.
3. **High: no rate limiting.**
   - **Fix:** a fixed-window limiter.
     - join: 20/min per IP
     - poll: 20/10s per user
     - leave: 30/min per IP
     - signal: 100/10s per user
     - request + accept: a shared 6/min, so strangers can't be spammed
   - **Also:** inboxes are capped at 100 pending signals.
4. **High: location could be recovered.** A fresh random jitter on every join
   meant re-joining and averaging the dots revealed the real position.
   - **Fix:** snap to a ~1 km grid cell, then apply a fixed offset derived from
     an HMAC of the cell under `LOCATION_PRIVACY_SECRET`. The dot is always the
     same, 1–3 km from the user, so averaging gains nothing.
5. **Medium: anonymous harvesting and input abuse.**
   - Poll returns nothing unless the caller is on the map.
   - Signals require a present sender and an existing recipient.
   - Strict validation of the body, type and per-type payload, with SDP and
     ICE payloads capped at 16 KB.

## Phase 4 — Make it better

Two small features that tell one story: **life on the globe, consent in the
call.**

### Mutual-reveal video (safe)

- **What:** every video call starts blurred. Each person taps **Reveal**, and
  the picture only sharpens once *both* have. Either person can blur again,
  which blurs it for both.
- **Why:** unwanted exposure is the defining failure of random video chat.
  Consent should be built into the medium, not left to a report button.
- **How:**
  - **Sender:** an on-device "veil" shrinks each camera frame to 16px wide and
    scales it back up on a canvas. That canvas track is what gets sent.
    `replaceTrack` swaps in the real camera only once both have opted in, with
    no renegotiation. **The real image never leaves the device before
    then.**
  - **Receiver:** incoming video is also CSS-blurred until both opt in, so a
    modified client that skips the veil still can't flash anyone.
  - **Signalling:** reveal state syncs over the data channel
    (`reveal-on` / `reveal-off`).
- **Verified:** with two headless browsers, received frames had **0** hard
  edges before the reveal and about 920 after. They drop back to 0 when either
  side blurs.
- **Trade-off:** audio isn't gated.

### Connection arcs (alive)

- **What:** when a request is accepted, a gold arc draws itself along the
  great circle from requester to accepter, on **everyone's** globe. A comet
  head leads it and both ends ripple. It then settles into a faint line that
  stays for as long as the two are connected, and fades out when they end.
- **Framing:** on request, both people's maps fly to fit the pair, centred on
  the arc's midpoint. When the chat drawer opens, the map shifts so the pair
  stays clear of it. The arc always lands in view.
- **Why:** dots alone feel static. Arcs make the world visibly pulse with
  conversations, even when you're not in one.
- **How:**
  - **Server:** an accept stores an `Arc` with the two already-offset dot
    positions. The pair's public ids stay server-side so the arc can be
    removed on end, decline or leave, or when either person drops off the map.
    `poll` sends only positions, plus `fresh` for arcs under 10s old.
  - **Client:** arcs are reconciled by id. Fresh ones animate in, using
    `line-gradient` and an animated `line-trim-offset`. Ones that were already
    live (e.g. after a reload) fade straight in at rest. At rest no animation
    runs, so the globe doesn't keep repainting. `prefers-reduced-motion` is
    respected.
  - **Abuse:** accepts share the 6/min request limit, so arcs can't be
    spammed.
- **Migrations:** `20261025120000_add_arcs`, then `20261025180000_persist_arcs`. The DB was
  originally created with `db push`, so apply them with `prisma db execute`, or
  baseline with `migrate resolve` first.
