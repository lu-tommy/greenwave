"use client";

import { useEffect, useState } from "react";
import { RoutingUnavailableError } from "@/lib/routing/MapboxRoutingProvider";
import { getRecentDestinations } from "@/lib/storage/recentDestinations";
import type { DestinationCandidate, LatLng, RoutingProvider } from "@/lib/types";

export function DestinationSearch({
  origin,
  provider,
  onSelect,
}: {
  origin: LatLng | null;
  provider: RoutingProvider;
  onSelect: (destination: DestinationCandidate) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DestinationCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [recents] = useState(() => getRecentDestinations());

  useEffect(() => {
    if (!query.trim()) {
      queueMicrotask(() => setResults([]));
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const candidates = await provider.searchDestination(query, origin ?? undefined);
        if (!cancelled) {
          setResults(candidates);
          setUnavailable(null);
        }
      } catch (err) {
        if (!cancelled) {
          setResults([]);
          setUnavailable(err instanceof RoutingUnavailableError ? err.message : "Destination search failed.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, origin, provider]);

  const showRecents = query.trim() === "" && recents.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium tracking-[0.1em] text-foreground-dim">WHERE ARE YOU GOING?</span>
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          placeholder="Search destination…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-xl border border-border-subtle bg-surface px-4 py-3 text-base text-foreground placeholder:text-foreground-dim focus:border-accent-blue focus:outline-none"
        />
      </label>

      {unavailable && (
        <p className="rounded-lg border border-accent-amber/30 bg-accent-amber/5 px-3 py-2 text-xs text-accent-amber">
          {unavailable}
        </p>
      )}

      {loading && <p className="text-xs text-foreground-dim">Searching…</p>}

      {!loading && results.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
          {results.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onSelect(c)}
                className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-surface-raised"
              >
                <span className="text-sm font-medium text-foreground">{c.name}</span>
                <span className="text-xs text-foreground-muted">{c.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showRecents && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-[0.1em] text-foreground-dim">RECENT</span>
          <ul className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
            {recents.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c)}
                  className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-surface-raised"
                >
                  <span className="text-sm font-medium text-foreground">{c.name}</span>
                  <span className="text-xs text-foreground-muted">{c.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
