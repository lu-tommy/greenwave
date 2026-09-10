import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for destination search (Mapbox Geocoding). The token
 * (MAPBOX_TOKEN) stays server-only — it is never sent to the browser. This
 * also sidesteps CORS entirely, per the project's "no browser CORS hacks"
 * rule.
 */
export async function GET(req: NextRequest) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "MAPBOX_TOKEN not configured", candidates: [] }, { status: 501 });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.trim();
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!query) {
    return NextResponse.json({ error: "missing q", candidates: [] }, { status: 400 });
  }

  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", "5");
  url.searchParams.set("autocomplete", "true");
  if (lat && lng) url.searchParams.set("proximity", `${lng},${lat}`);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return NextResponse.json({ error: `geocoding upstream ${res.status}`, candidates: [] }, { status: 502 });
    }
    const data = await res.json();
    type MapboxFeature = { id: string; text: string; place_name: string; center: [number, number] };
    const candidates = ((data.features ?? []) as MapboxFeature[]).map((f) => ({
      id: f.id,
      name: f.text,
      description: f.place_name,
      location: { lat: f.center[1], lng: f.center[0] },
    }));
    return NextResponse.json({ candidates });
  } catch {
    return NextResponse.json({ error: "geocoding request failed", candidates: [] }, { status: 502 });
  }
}
