import { ImageResponse } from "next/og";

/** Dedicated 192x192 PWA icon route (referenced from app/manifest.ts) — separate from the favicon-sized app/icon.tsx. */
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0b0d",
        }}
      >
        <div style={{ width: 88, height: 88, borderRadius: "50%", background: "#3ddc84" }} />
      </div>
    ),
    { width: 192, height: 192 },
  );
}
