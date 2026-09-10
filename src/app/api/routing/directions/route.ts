import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for Mapbox Directions (mapbox/driving-traffic). Returns
 * full route geometry + steps as GeoJSON-derived plain coordinates. Token
 * stays server-only.
 */
export async function GET(req: NextRequest) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "MAPBOX_TOKEN not configured" }, { status: 501 });
  }

  const { searchParams } = new URL(req.url);
  const originLat = searchParams.get("originLat");
  const originLng = searchParams.get("originLng");
  const destLat = searchParams.get("destLat");
  const destLng = searchParams.get("destLng");
  const profile = searchParams.get("profile") === "driving" ? "driving" : "driving-traffic";

  if (!originLat || !originLng || !destLat || !destLng) {
    return NextResponse.json({ error: "missing coordinates" }, { status: 400 });
  }

  const coords = `${originLng},${originLat};${destLng},${destLat}`;
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");
  url.searchParams.set("overview", "full");
  url.searchParams.set("annotations", "maxspeed");

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      return NextResponse.json({ error: `directions upstream ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    if (!data.routes?.length) {
      return NextResponse.json({ error: "no route found" }, { status: 404 });
    }
    return NextResponse.json({ route: data.routes[0] });
  } catch {
    return NextResponse.json({ error: "directions request failed" }, { status: 502 });
  }
}
