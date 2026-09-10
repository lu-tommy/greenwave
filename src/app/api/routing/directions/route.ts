import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for routing directions, via the public OSRM demo
 * server (https://project-osrm.org) — open source, no API key, no
 * account, no credit card. It's a shared community resource meant for
 * light/evaluation use, not high-volume production traffic; set
 * OSRM_BASE_URL to point this at a self-hosted OSRM instance if you need
 * more headroom (same request shape, drop-in replacement).
 */
const DEFAULT_OSRM_BASE_URL = "https://router.project-osrm.org";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const originLat = searchParams.get("originLat");
  const originLng = searchParams.get("originLng");
  const destLat = searchParams.get("destLat");
  const destLng = searchParams.get("destLng");

  if (!originLat || !originLng || !destLat || !destLng) {
    return NextResponse.json({ error: "missing coordinates" }, { status: 400 });
  }

  const baseUrl = process.env.OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL;
  const coords = `${originLng},${originLat};${destLng},${destLat}`;
  const url = new URL(`${baseUrl}/route/v1/driving/${coords}`);
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");
  url.searchParams.set("overview", "full");

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 429) {
      return NextResponse.json({ error: "Routing server busy, try again shortly" }, { status: 503 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `directions upstream ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) {
      return NextResponse.json({ error: "no route found" }, { status: 404 });
    }
    return NextResponse.json({ route: data.routes[0] });
  } catch {
    return NextResponse.json({ error: "directions request failed" }, { status: 502 });
  }
}
