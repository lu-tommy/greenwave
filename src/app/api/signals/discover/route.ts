import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for OSM traffic-signal discovery via the Overpass API.
 * Keeps Overpass-specific query construction out of the browser bundle and
 * off the client entirely (also avoids CORS and lets us apply one shared
 * timeout/error-handling policy).
 *
 * Input: a downsampled list of route points + a search radius. We query
 * nodes tagged highway=traffic_signals within `radiusM` of ANY of those
 * points ("around" the route corridor), NOT a single large bounding box —
 * this keeps queries proportional to route length instead of to the area
 * of its bounding rectangle.
 */

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const MAX_POINTS = 400;
const MAX_RADIUS_M = 100;

type LatLngIn = { lat: number; lng: number };

export async function POST(req: NextRequest) {
  let body: { points?: LatLngIn[]; radiusM?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body", signals: [] }, { status: 400 });
  }

  const points = (body.points ?? []).slice(0, MAX_POINTS);
  const radiusM = Math.min(Math.max(body.radiusM ?? 40, 10), MAX_RADIUS_M);

  if (points.length === 0) {
    return NextResponse.json({ error: "no points supplied", signals: [] }, { status: 400 });
  }

  const coordList = points.map((p) => `${p.lat},${p.lng}`).join(",");
  const query = `[out:json][timeout:25];node(around:${radiusM},${coordList})[highway=traffic_signals];out body;`;

  try {
    const res = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
      signal: AbortSignal.timeout(20_000),
    });

    if (res.status === 429 || res.status === 504) {
      return NextResponse.json({ error: "Overpass API busy, try again shortly", signals: [] }, { status: 503 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `Overpass upstream ${res.status}`, signals: [] }, { status: 502 });
    }

    const data = await res.json();
    type OverpassNode = { type: string; id: number; lat: number; lon: number; tags?: Record<string, string> };
    const nodes = ((data.elements ?? []) as OverpassNode[]).filter((e) => e.type === "node");

    const signals = nodes.map((n) => ({
      osmId: n.id,
      lat: n.lat,
      lng: n.lon,
      tags: n.tags ?? {},
    }));

    return NextResponse.json({ signals });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json(
      { error: timedOut ? "Overpass request timed out" : "Overpass request failed", signals: [] },
      { status: 502 },
    );
  }
}
