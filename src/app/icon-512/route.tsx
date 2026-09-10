import { ImageResponse } from "next/og";

/** Dedicated 512x512 PWA icon route (referenced from app/manifest.ts). */
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
        <div style={{ width: 232, height: 232, borderRadius: "50%", background: "#3ddc84" }} />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
