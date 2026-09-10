import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for destination search, via Nominatim
 * (https://nominatim.org) — OpenStreetMap's open, key-free geocoder. No
 * account, no token, no credit card. Nominatim's usage policy asks for a
 * descriptive User-Agent and a max of ~1 request/second per client, which
 * this route honors; set NOMINATIM_BASE_URL to point at a self-hosted
 * instance for anything beyond light personal use.
 */
const DEFAULT_NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "GreenWave/1.0 (open-source GLOSA app; https://github.com/lu-tommy/greenwave)";
const PROXIMITY_BIAS_DEG = 0.35; // ~35-40km soft bias box around the origin, not a hard bound

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.trim();
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!query) {
    return NextResponse.json({ error: "missing q", candidates: [] }, { status: 400 });
  }

  const baseUrl = process.env.NOMINATIM_BASE_URL || DEFAULT_NOMINATIM_BASE_URL;
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  if (lat && lng) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    url.searchParams.set(
      "viewbox",
      `${lngNum - PROXIMITY_BIAS_DEG},${latNum + PROXIMITY_BIAS_DEG},${lngNum + PROXIMITY_BIAS_DEG},${latNum - PROXIMITY_BIAS_DEG}`,
    );
    url.searchParams.set("bounded", "0"); // bias toward the box, don't exclude everything else
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    });
    if (res.status === 429) {
      return NextResponse.json({ error: "Search server busy, try again shortly", candidates: [] }, { status: 503 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `geocoding upstream ${res.status}`, candidates: [] }, { status: 502 });
    }
    const data = await res.json();
    type NominatimResult = { place_id: number; display_name: string; name?: string; lat: string; lon: string };
    const candidates = ((data ?? []) as NominatimResult[]).map((r) => ({
      id: String(r.place_id),
      name: r.name || r.display_name.split(",")[0],
      description: r.display_name,
      location: { lat: Number(r.lat), lng: Number(r.lon) },
    }));
    return NextResponse.json({ candidates });
  } catch {
    return NextResponse.json({ error: "geocoding request failed", candidates: [] }, { status: 502 });
  }
}
