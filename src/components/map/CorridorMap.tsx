"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { GeoJSONSource, LngLatBounds, Map as MapLibreMap, Marker, Popup, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { getSignalPhaseAtTime, predictSignalState } from "@/lib/signals/signalEngine";
import { formatDuration } from "@/lib/geo/units";
import { pointAtDistance } from "@/lib/geo/distance";
import type { Corridor, SignalPhaseName } from "@/lib/types";

const PHASE_HEX: Record<SignalPhaseName, string> = {
  green: "#3ddc84",
  yellow: "#f5b942",
  red: "#ef5c5c",
};

// Plain raster OpenStreetMap tiles — free, key-free, and far more legible
// than MapLibre's sparse vector demo style at street-level zoom. If tiles
// fail to load entirely (offline, blocked), the component falls back to a
// themed panel — the app must keep working without map imagery.
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export type CorridorMapProps = {
  corridor: Corridor;
  /** Current position along the corridor, meters. Omit to hide the vehicle marker. */
  vehiclePositionM?: number;
  /** Timestamp used to color signal markers by current phase. */
  timestamp: number;
  /** Hides signal detail popups and other non-essential chrome for driving mode. */
  compact?: boolean;
  className?: string;
};

export function CorridorMap({ corridor, vehiclePositionM, timestamp, compact = false, className = "" }: CorridorMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleMarkerRef = useRef<Marker | null>(null);
  const signalMarkersRef = useRef<Marker[]>([]);
  const [mapError, setMapError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: OSM_STYLE,
        center: [corridor.polyline[0]?.lng ?? 0, corridor.polyline[0]?.lat ?? 0],
        zoom: 15,
        attributionControl: false,
      });
    } catch {
      queueMicrotask(() => setMapError(true));
      return;
    }

    map.on("error", () => setMapError(true));
    map.on("load", () => setLoaded(true));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corridor.id]);

  // Draw the corridor line once loaded.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const sourceId = "corridor-line";
    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: corridor.polyline.map((p) => [p.lng, p.lat]),
      },
    };

    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as GeoJSONSource).setData(geojson);
    } else {
      map.addSource(sourceId, { type: "geojson", data: geojson });
      map.addLayer({
        id: "corridor-line-layer",
        type: "line",
        source: sourceId,
        paint: { "line-color": "#4d9fff", "line-width": 4, "line-opacity": 0.55 },
      });
    }

    const bounds = corridor.polyline.reduce(
      (b, p) => b.extend([p.lng, p.lat]),
      new LngLatBounds(
        [corridor.polyline[0].lng, corridor.polyline[0].lat],
        [corridor.polyline[0].lng, corridor.polyline[0].lat],
      ),
    );
    map.fitBounds(bounds, { padding: 48, duration: 0 });
  }, [loaded, corridor]);

  // Signal markers, recolored by current phase each render.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    signalMarkersRef.current.forEach((m) => m.remove());
    signalMarkersRef.current = corridor.intersections.map((intersection) => {
      const phase = getSignalPhaseAtTime(intersection.signalPlan, timestamp);
      const el = document.createElement("div");
      el.style.width = "14px";
      el.style.height = "14px";
      el.style.borderRadius = "50%";
      el.style.background = PHASE_HEX[phase];
      el.style.border = "2px solid rgba(10,11,13,0.8)";
      el.style.boxShadow = "0 0 6px rgba(0,0,0,0.5)";
      el.style.opacity = intersection.confidence < 0.4 ? "0.5" : "1";

      const marker = new Marker({ element: el }).setLngLat([intersection.lng, intersection.lat]);

      if (!compact) {
        const prediction = predictSignalState(intersection, timestamp);
        const popupHtml = `
          <div style="font: 12px system-ui; color: #111; line-height: 1.5;">
            <strong>${intersection.name}</strong><br/>
            phase: ${prediction.phase}<br/>
            next transition: ${formatDuration(prediction.secondsRemainingInPhase)}<br/>
            cycle: ${intersection.signalPlan.cycleSec}s · offset: ${intersection.signalPlan.offsetSec.toFixed(1)}s<br/>
            confidence: ${Math.round(intersection.confidence * 100)}%
          </div>`;
        marker.setPopup(new Popup({ offset: 16 }).setHTML(popupHtml));
      }

      marker.addTo(map);
      return marker;
    });
  }, [loaded, corridor, timestamp, compact]);

  // Vehicle marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    if (vehiclePositionM == null) {
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      return;
    }

    const point = pointAtDistance(corridor.polyline, vehiclePositionM);

    if (!vehicleMarkerRef.current) {
      const el = document.createElement("div");
      el.style.width = "18px";
      el.style.height = "18px";
      el.style.borderRadius = "50%";
      el.style.background = "#f4f5f6";
      el.style.border = "3px solid #4d9fff";
      el.style.boxShadow = "0 0 10px rgba(77,159,255,0.7)";
      vehicleMarkerRef.current = new Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map);
    } else {
      vehicleMarkerRef.current.setLngLat([point.lng, point.lat]);
    }
  }, [loaded, vehiclePositionM, corridor]);

  if (mapError) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 rounded-xl border border-border-subtle bg-surface text-center ${className}`}
      >
        <span className="text-sm text-foreground-muted">Map unavailable</span>
        <span className="text-xs text-foreground-dim">Recommendations and simulation still work normally.</span>
      </div>
    );
  }

  return <div ref={containerRef} className={`overflow-hidden rounded-xl ${className}`} />;
}
