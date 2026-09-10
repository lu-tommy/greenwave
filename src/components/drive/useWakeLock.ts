"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keeps the screen awake during active driving via the Wake Lock API, when
 * available. Purely a progressive enhancement — Safari on iOS has historically
 * lacked support in some versions, and this must never block or error the
 * driving experience when it isn't there.
 */
export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const [supported] = useState(() => typeof navigator !== "undefined" && "wakeLock" in navigator);

  useEffect(() => {
    if (!active || !supported) return;
    let cancelled = false;

    async function acquire() {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Denied, unsupported in this context, or battery saver — fall back silently.
      }
    }

    void acquire();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void acquire();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
    };
  }, [active, supported]);

  return { supported };
}
