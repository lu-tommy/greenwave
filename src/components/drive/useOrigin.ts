"use client";

import { useCallback, useState } from "react";
import type { LatLng } from "@/lib/types";

export type OriginStatus = "idle" | "requesting" | "ready" | "denied" | "unsupported" | "error";

/** One-shot "use current location as origin" — distinct from the continuous watch used during active driving. */
export function useOrigin() {
  const [status, setStatus] = useState<OriginStatus>("idle");
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestOrigin = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    setStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("ready");
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
        setErrorMessage(err.message);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }, []);

  return { status, origin, errorMessage, requestOrigin };
}
