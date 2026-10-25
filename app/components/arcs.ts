import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import type { ArcEvent } from "@/lib/types";

// Each new connection draws itself across the globe like a comet, from the
// requester to the accepter, holds for a moment, then settles into a faint
// line that stays until the connection ends. The two ends ripple as it leaves
// and lands.

const POINTS = 64;
const DRAW_MS = 1400;
const HOLD_MS = 1200;
const SETTLE_MS = 1600;
const FADE_IN_MS = 600; // arcs already live when we first see them
const FADE_OUT_MS = 800;
const REST_OPACITY = 0.35;
const RIPPLE_MS = 900;
const RIPPLE_RADIUS = 22;

const GLOW = "rgba(255, 196, 80, 0.55)";
const CORE_START = "rgba(255, 214, 102, 0.2)";
const CORE_END = "rgba(255, 240, 190, 1)";

type LngLat = [number, number];

// Points along the great circle between two positions, so the arc follows the
// curve of the globe. Longitudes are unwrapped so it never jumps across the
// antimeridian.
export function greatCircle(from: LngLat, to: LngLat, n = POINTS): LngLat[] {
  const r = Math.PI / 180;
  const toVec = ([lng, lat]: LngLat) => [
    Math.cos(lat * r) * Math.cos(lng * r),
    Math.cos(lat * r) * Math.sin(lng * r),
    Math.sin(lat * r),
  ];
  const a = toVec(from);
  const b = toVec(to);
  const dot = Math.min(
    1,
    Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]),
  );
  const d = Math.acos(dot);
  if (Math.sin(d) < 1e-6) return [from, to]; // same point, or antipodal

  const points: LngLat[] = [];
  let prevLng = from[0];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wa = Math.sin((1 - t) * d) / Math.sin(d);
    const wb = Math.sin(t * d) / Math.sin(d);
    const x = wa * a[0] + wb * b[0];
    const y = wa * a[1] + wb * b[1];
    const z = wa * a[2] + wb * b[2];
    let lng = Math.atan2(y, x) / r;
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    points.push([lng, Math.atan2(z, Math.hypot(x, y)) / r]);
  }
  return points;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export interface ArcHandle {
  // Fade out, then clean up.
  remove: () => void;
  // Clean up immediately (e.g. when the map is torn down).
  stop: () => void;
}

// Draws one arc. `fresh` arcs animate in; others (connections that were
// already live) simply fade in at rest.
export function drawArc(
  map: MapboxMap,
  arc: ArcEvent,
  {
    reducedMotion,
    onDone,
    onLanded,
  }: {
    reducedMotion: boolean;
    onDone: () => void;
    onLanded?: () => void;
  },
): ArcHandle {
  const id = `arc-${arc.id}`;
  const ends = `${id}-ends`;
  const head = `${id}-head`;
  const layers = [
    `${id}-glow`,
    `${id}-core`,
    `${id}-ripple`,
    `${id}-head-halo`,
    `${id}-head-dot`,
  ];
  const path = greatCircle(arc.from, arc.to);
  const point = (coordinates: LngLat) => ({
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Point" as const, coordinates },
  });

  map.addSource(id, {
    type: "geojson",
    lineMetrics: true, // needed for the gradient and the draw-in trim
    data: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: path },
    },
  });
  map.addSource(head, { type: "geojson", data: point(arc.from) });
  map.addSource(ends, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [arc.from, arc.to].map((coordinates, i) => ({
        type: "Feature",
        id: i,
        properties: {},
        geometry: { type: "Point", coordinates },
      })),
    },
  });

  const lineLayout = { "line-cap": "round", "line-join": "round" } as const;
  map.addLayer({
    id: layers[0],
    type: "line",
    source: id,
    layout: lineLayout,
    paint: {
      "line-color": GLOW,
      "line-width": 14,
      "line-blur": 10,
      "line-opacity": 0,
    },
  });
  map.addLayer({
    id: layers[1],
    type: "line",
    source: id,
    layout: lineLayout,
    paint: {
      "line-width": 3,
      "line-opacity": 0,
      // Brightest at the leading edge, like a comet's head.
      "line-gradient": [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        CORE_START,
        1,
        CORE_END,
      ],
    },
  });
  map.addLayer({
    id: layers[2],
    type: "circle",
    source: ends,
    paint: {
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-color": CORE_END,
      "circle-stroke-width": 2,
      "circle-radius": ["coalesce", ["feature-state", "r"], 0],
      "circle-stroke-opacity": ["coalesce", ["feature-state", "o"], 0],
    },
  });
  // The comet's head, riding the tip of the line while it draws.
  map.addLayer({
    id: layers[3],
    type: "circle",
    source: head,
    paint: {
      "circle-color": GLOW,
      "circle-radius": 12,
      "circle-blur": 1,
      "circle-opacity": 0,
    },
  });
  map.addLayer({
    id: layers[4],
    type: "circle",
    source: head,
    paint: {
      "circle-color": CORE_END,
      "circle-radius": 3.5,
      "circle-opacity": 0,
    },
  });

  // One ripple per end: the start as the arc leaves, the end as it lands.
  const ripple = (feature: number, elapsed: number) => {
    const t = clamp01(elapsed / RIPPLE_MS);
    map.setFeatureState(
      { source: ends, id: feature },
      { r: easeOut(t) * RIPPLE_RADIUS, o: t > 0 && t < 1 ? 1 - t : 0 },
    );
  };

  let opacity = 0;
  const setLine = (drawn: number, nextOpacity: number) => {
    opacity = nextOpacity;
    // Hide the not-yet-drawn tail; [0, 0] means no trim.
    const trim: [number, number] = drawn < 1 ? [drawn, 1] : [0, 0];
    for (const layer of layers.slice(0, 2)) {
      map.setPaintProperty(layer, "line-trim-offset", trim);
      map.setPaintProperty(layer, "line-opacity", opacity);
    }
  };
  const setHead = (at: number | null) => {
    if (at !== null) {
      const headSource = map.getSource(head) as GeoJSONSource | undefined;
      headSource?.setData(point(path[Math.round(at * (path.length - 1))]));
    }
    for (const layer of layers.slice(3)) {
      map.setPaintProperty(layer, "circle-opacity", at === null ? 0 : 1);
    }
  };

  // Runs `frame(elapsed)` every animation frame until it returns false. Once
  // an arc is at rest nothing runs, so a quiet globe doesn't keep repainting.
  let raf = 0;
  const animate = (frame: (t: number) => boolean) => {
    cancelAnimationFrame(raf);
    const start = performance.now();
    const tick = (now: number) => {
      if (frame(now - start)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    // The map may already be gone (or mid style change) on teardown.
    try {
      for (const layer of layers)
        if (map.getLayer(layer)) map.removeLayer(layer);
      for (const source of [id, ends, head]) {
        if (map.getSource(source)) map.removeSource(source);
      }
    } catch { }
    onDone();
  };

  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;
    onLanded?.();
  };

  if (arc.fresh) {
    animate((t) => {
      const drawn = reducedMotion ? 1 : easeOut(clamp01(t / DRAW_MS));
      if (drawn >= 1) land();
      const settle = clamp01((t - DRAW_MS - HOLD_MS) / SETTLE_MS);
      setLine(drawn, 1 - (1 - REST_OPACITY) * settle);
      setHead(drawn < 1 ? drawn : null);
      if (!reducedMotion) {
        ripple(0, t);
        ripple(1, t - DRAW_MS);
      }
      return settle < 1;
    });
  } else {
    land();
    animate((t) => {
      setLine(1, REST_OPACITY * clamp01(t / FADE_IN_MS));
      return t < FADE_IN_MS;
    });
  }

  let removing = false;
  const remove = () => {
    if (removing || stopped) return;
    removing = true;
    const from = opacity;
    setHead(null);
    ripple(0, RIPPLE_MS);
    ripple(1, RIPPLE_MS);
    animate((t) => {
      const fade = clamp01(t / FADE_OUT_MS);
      setLine(1, from * (1 - fade));
      if (fade >= 1) stop();
      return fade < 1;
    });
  };

  return { remove, stop };
}
