"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { AvatarFullConfig } from "react-nice-avatar";
import type { ArcEvent, PeerDot } from "@/lib/types";
import { drawArc, greatCircle, type ArcHandle } from "./arcs";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "pk.eyJ1IjoicHVsc2UtbWFwIiwiYSI6ImNrMDBkZW1vMDAwMDAwMDAifQ.AAAAAAAAAAAAAAAAAAAAAA";
const DRAWER_WIDTH = 448;
const FRAME_PADDING = 80;

// Recolor Mapbox's dark style: blue water, green land, and a blue atmosphere
// around the globe. Kept dark so the white controls and avatars still pop.
const WATER = "hsl(208, 65%, 30%)";
const LAND = "hsl(145, 32%, 26%)";

// Browser-only libraries, imported once and shared by every effect.
let libsPromise: Promise<{
  mapboxgl: typeof import("mapbox-gl").default;
  avatar: typeof import("react-nice-avatar");
}> | null = null;

function loadLibs() {
  libsPromise ??= Promise.all([
    import("mapbox-gl"),
    import("react-nice-avatar"),
  ]).then(([mapbox, avatar]) => ({ mapboxgl: mapbox.default, avatar }));
  return libsPromise;
}

// Start downloading while the user is still on the entry gate, so the map and
// avatars are ready by the time they enter.
if (typeof window !== "undefined") {
  preconnect("https://api.mapbox.com");
  void loadLibs();
}

// genConfig(id) is deterministic, so each face is computed once per user and
// reused if they drop off the map and come back.
const avatarConfigs = new Map<string, Required<AvatarFullConfig>>();

function avatarConfig(
  genConfig: typeof import("react-nice-avatar").genConfig,
  id: string,
) {
  let config = avatarConfigs.get(id);
  if (!config) {
    config = genConfig(id);
    avatarConfigs.set(id, config);
  }
  return config;
}

function applyMapColors(map: MapboxMap) {
  map.setPaintProperty("land", "background-color", LAND);
  map.setPaintProperty("landuse", "fill-color", "hsl(135, 35%, 30%)");
  map.setPaintProperty("water", "fill-color", WATER);
  map.setPaintProperty("waterway", "line-color", WATER);
  // Halos drawn under borders; match the land so they don't read as gray lines.
  map.setPaintProperty("admin-0-boundary-bg", "line-color", LAND);
  map.setPaintProperty("admin-1-boundary-bg", "line-color", LAND);
  // Every text label in white; the style's dark halos keep them legible.
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "symbol" && layer.layout?.["text-field"]) {
      map.setPaintProperty(layer.id, "text-color", "#ffffff");
    }
  }
  // The style draws province/state names at half opacity.
  map.setPaintProperty("state-label", "text-opacity", 1);
  map.setFog({
    color: "hsl(205, 70%, 35%)",
    "high-color": "hsl(220, 80%, 18%)",
    "space-color": "hsl(230, 50%, 6%)",
    "horizon-blend": 0.05,
    "star-intensity": 0.35,
  });
}

// Fly to a point, without zooming back out if the user is already closer.
function centerOn(map: MapboxMap, lng: number, lat: number) {
  map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 4) });
}

// Fly to show two people at once: centered on the midpoint of the arc between
// them, zoomed so both fit, and clear of the chat drawer when it's open.
function frameBoth(
  map: MapboxMap,
  a: [number, number],
  b: [number, number],
  drawerOpen: boolean,
) {
  const { width } = map.getContainer().getBoundingClientRect();
  const right = drawerOpen && width >= DRAWER_WIDTH * 2 ? DRAWER_WIDTH : 0;
  // Unwrap so the box spans the short way around, not the whole world.
  let bLng = b[0];
  if (bLng - a[0] > 180) bLng -= 360;
  else if (bLng - a[0] < -180) bLng += 360;
  const camera = map.cameraForBounds(
    [
      [Math.min(a[0], bLng), Math.min(a[1], b[1])],
      [Math.max(a[0], bLng), Math.max(a[1], b[1])],
    ],
    {
      padding: {
        top: FRAME_PADDING,
        bottom: FRAME_PADDING,
        left: FRAME_PADDING,
        right: FRAME_PADDING + right,
      },
    },
  );
  map.flyTo({
    center: greatCircle(a, b, 2)[1],
    // Far apart: the whole globe. Close together: near, but not street level.
    zoom: Math.min(Math.max(camera?.zoom ?? 1.5, 1), 6),
    offset: [-right / 2, 0],
    duration: 1600,
  });
}

interface PeerMarker {
  marker: Marker;
  button: HTMLButtonElement;
  root: Root;
  busy: boolean;
}

function removePeerMarker({ marker, root }: PeerMarker) {
  marker.remove();
  // Deferred so this is safe to call from an effect cleanup, while React is
  // still committing.
  queueMicrotask(() => root.unmount());
}

export default function WorldMap({
  peers,
  arcs,
  me,
  onPeerClick,
  canConnect,
  focusId,
  drawerOpen,
}: {
  peers: PeerDot[];
  arcs: ArcEvent[];
  me: { lat: number; lng: number } | null;
  onPeerClick: (id: string) => void;
  canConnect: boolean;
  // The person we're requesting / connected to, framed together with us.
  focusId: string | null;
  drawerOpen: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, PeerMarker>>(new Map());
  const meMarkerRef = useRef<Marker | null>(null);
  // Arcs on the map by id, plus every arc still on screen (including ones
  // fading out after their connection ended) so teardown can clear them.
  const arcsByIdRef = useRef<Map<string, ArcHandle>>(new Map());
  const activeArcsRef = useRef<Set<ArcHandle>>(new Set());
  const [ready, setReady] = useState(false);

  // Marker click handlers are bound once, so read the live click handler +
  // connectability through refs (synced in an effect, never during render).
  const onPeerClickRef = useRef(onPeerClick);
  const canConnectRef = useRef(canConnect);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
  });

  // Initialise the map once.
  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    const markers = markersRef.current;
    const arcsById = arcsByIdRef.current;
    const activeArcs = activeArcsRef.current;

    (async () => {
      const { mapboxgl } = await loadLibs();
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        // Open centered on the user if we know where they are, else world view.
        center: me ? [me.lng, me.lat] : [0, 20],
        zoom: me ? 4 : 1.4,
        attributionControl: true,
      });
      map.on("style.load", () => applyMapColors(map));
      map.on("load", () => {
        if (!cancelled) setReady(true);
      });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      activeArcs.forEach((arc) => arc.stop());
      arcsById.clear();
      markers.forEach(removePeerMarker);
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // `me` is only read for the initial center; we don't want to re-init on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show / move the user's own "you are here" pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;

    (async () => {
      const { mapboxgl } = await loadLibs();
      if (cancelled) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pulse-me";
        el.title = "You are here";
        el.innerHTML = `<span class="pulse-me-label">Me</span>📍`;
        // anchor "bottom" → the pin's tip sits on the exact coordinate.
        meMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  // Reconcile markers whenever the peer list changes (or the map becomes ready).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const { mapboxgl, avatar } = await loadLibs();
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();

      for (const peer of peers) {
        seen.add(peer.id);
        let entry = markers.get(peer.id);
        if (!entry) {
          // Mapbox positions the wrapper with an inline transform, so hover
          // effects go on the button inside it, never on the marker element.
          const el = document.createElement("div");
          const button = document.createElement("button");
          button.className = "pulse-avatar";
          el.append(button);
          button.addEventListener("click", (e) => {
            e.stopPropagation();
            // Requesting frames both of us instead (see below).
            if (canConnectRef.current) onPeerClickRef.current(peer.id);
            else centerOn(map, peer.lng, peer.lat);
          });
          // Rendered once; the avatar never changes for a given user.
          const root = createRoot(button);
          root.render(
            createElement(avatar.default, {
              ...avatarConfig(avatar.genConfig, peer.id),
              shape: "circle",
              style: { width: "100%", height: "100%" },
            }),
          );
          const marker = new mapboxgl.Marker({ element: el })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map);
          entry = { marker, button, root, busy: !peer.busy };
          markers.set(peer.id, entry);
        }
        // Only touch the DOM when busy actually flips, not on every poll.
        if (entry.busy !== peer.busy) {
          entry.busy = peer.busy;
          entry.button.classList.toggle("is-busy", peer.busy);
          entry.button.title = peer.busy ? "Busy" : "Tap to connect";
        }
      }

      // Drop markers for peers that went offline / got filtered out.
      for (const [id, entry] of markers) {
        if (!seen.has(id)) {
          removePeerMarker(entry);
          markers.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peers, ready]);

  // Reconcile arcs: draw each live connection once, and fade out the ones
  // whose connection has ended.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const byId = arcsByIdRef.current;
    const active = activeArcsRef.current;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const live = new Set<string>();
    for (const arc of arcs) {
      live.add(arc.id);
      if (byId.has(arc.id)) continue;
      const handle = drawArc(map, arc, {
        reducedMotion,
        onDone: () => active.delete(handle),
      });
      byId.set(arc.id, handle);
      active.add(handle);
    }
    for (const [id, handle] of byId) {
      if (!live.has(id)) {
        handle.remove();
        byId.delete(id);
      }
    }
  }, [arcs, ready]);

  // Frame us and the other person together when a connection starts, and
  // again when the chat drawer opens, so the arc between us is in view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusId) return;
    const peer = markersRef.current.get(focusId)?.marker.getLngLat();
    const self = meMarkerRef.current?.getLngLat();
    if (!peer || !self) return;
    frameBoth(map, [self.lng, self.lat], [peer.lng, peer.lat], drawerOpen);
  }, [focusId, drawerOpen, ready]);

  function recenter() {
    if (me && mapRef.current) centerOn(mapRef.current, me.lng, me.lat);
  }

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full bg-zinc-900" />

      {!TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-md rounded-lg bg-zinc-800 p-4 text-sm text-zinc-200">
            Set{" "}
            <code className="text-emerald-400">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code>.env</code> to load the map.
          </p>
        </div>
      )}

      {/* Light pills stand out against the dark map and panels. */}
      <div className="absolute right-4 top-4 flex flex-col items-stretch gap-2 text-xs font-medium">
        <div className="flex items-center justify-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-zinc-900 shadow-lg ring-1 ring-black/5 backdrop-blur">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {peers.length} online
        </div>

        <button
          onClick={recenter}
          disabled={!me || !ready}
          title="Center on my location"
          className="flex items-center justify-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-zinc-900 shadow-lg ring-1 ring-black/5 backdrop-blur transition hover:bg-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        >
          📍 My location
        </button>
      </div>
    </div>
  );
}
