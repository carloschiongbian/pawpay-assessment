"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Map as MapboxMap } from "mapbox-gl";
import { applyMapColors, loadLibs, MAP_STYLE, TOKEN } from "./WorldMap";

// West to east, like the real Earth: a full turn every three minutes.
const DEGREES_PER_SECOND = 2;
const START: [number, number] = [110, 15];

// Placeholder people, not live users: a face per city, seeded by its name so
// it's the same on every visit.
const PLACEHOLDERS: [string, number, number][] = [
  ["New York", -74.0, 40.7],
  ["Los Angeles", -118.2, 34.1],
  ["Mexico City", -99.1, 19.4],
  ["São Paulo", -46.6, -23.5],
  ["London", -0.1, 51.5],
  ["Lagos", 3.4, 6.5],
  ["Cairo", 31.2, 30.0],
  ["Nairobi", 36.8, -1.3],
  ["Moscow", 37.6, 55.8],
  ["Mumbai", 72.9, 19.1],
  ["Bangkok", 100.5, 13.7],
  ["Jakarta", 106.8, -6.2],
  ["Manila", 121.0, 14.6],
  ["Seoul", 127.0, 37.5],
  ["Tokyo", 139.7, 35.7],
  ["Sydney", 151.2, -33.9],
];

// A blurred, slowly turning globe behind the landing page. Purely decorative:
// no interaction, hidden from screen readers, and still for reduced motion.
export default function GlobeBackdrop() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    let raf = 0;
    let map: MapboxMap | null = null;
    const roots: Root[] = [];

    (async () => {
      const { mapboxgl, avatar } = await loadLibs();
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: START,
        zoom: 1.6,
        interactive: false,
        attributionControl: false,
      });
      map.on("style.load", () => {
        if (!map) return;
        applyMapColors(map);
        // Blurred labels just read as smudges; keep only land and sea.
        for (const layer of map.getStyle()?.layers ?? []) {
          if (layer.type === "symbol") {
            map.setLayoutProperty(layer.id, "visibility", "none");
          }
        }
      });
      map.once("load", () => {
        if (cancelled || !map) return;
        for (const [seed, lng, lat] of PLACEHOLDERS) {
          // Mapbox positions (and re-enables pointer events on) the wrapper;
          // the face inside ignores the mouse, so there's no hover effect to
          // fight Mapbox's transform.
          const el = document.createElement("div");
          const face = document.createElement("div");
          face.className = "pulse-avatar";
          face.style.pointerEvents = "none";
          el.append(face);
          const root = createRoot(face);
          root.render(
            createElement(avatar.default, {
              ...avatar.genConfig(seed),
              shape: "circle",
              style: { width: "100%", height: "100%" },
            }),
          );
          roots.push(root);
          new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
        }
        setLoaded(true);
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          return;
        }
        const start = performance.now();
        const spin = (now: number) => {
          const lng = START[0] - ((now - start) / 1000) * DEGREES_PER_SECOND;
          map?.jumpTo({ center: [lng, START[1]] });
          raf = requestAnimationFrame(spin);
        };
        raf = requestAnimationFrame(spin);
      });
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      map?.remove();
      // Deferred: unmounting a root during React's own cleanup isn't allowed.
      queueMicrotask(() => roots.forEach((root) => root.unmount()));
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div
        className={`absolute inset-0 blur-[6px] transition-opacity duration-1000 ${
          loaded ? "opacity-90" : "opacity-0"
        }`}
      >
        {/* Mapbox adds its own classes here, so React never restyles it. */}
        <div ref={containerRef} className="h-full w-full" />
      </div>
      {/* Darken toward the edges and behind the text so it stays readable. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(9,9,11,0.35)_0%,rgba(9,9,11,0.8)_75%)]" />
    </div>
  );
}
