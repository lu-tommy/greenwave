"use client";

import { useEffect, useState } from "react";
import { clearAllSignalKnowledge, deleteSignalKnowledge, getAllSignalKnowledge } from "@/lib/storage/signalKnowledgeStore";
import { formatDuration } from "@/lib/geo/units";
import type { SignalKnowledgeRecord } from "@/lib/types";

function timeAgo(ts: number): string {
  const sec = Math.max(0, (Date.now() - ts) / 1000);
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86_400)}d ago`;
}

export function RealWorldSignalKnowledge() {
  const [records, setRecords] = useState<SignalKnowledgeRecord[] | null>(null);

  async function reload() {
    setRecords(await getAllSignalKnowledge());
  }

  useEffect(() => {
    let cancelled = false;
    getAllSignalKnowledge().then((all) => {
      if (!cancelled) setRecords(all);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(signalId: string) {
    await deleteSignalKnowledge(signalId);
    await reload();
  }

  async function handleClearAll() {
    await clearAllSignalKnowledge();
    await reload();
  }

  if (records == null) {
    return <p className="text-sm text-foreground-dim">Loading real-world signal knowledge…</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Real-World Signal Knowledge</h2>
          <p className="text-xs text-foreground-dim">
            Learned from your drives. Never required before driving — this is just visibility into what Green Wave
            has picked up so far.
          </p>
        </div>
        {records.length > 0 && (
          <button
            onClick={handleClearAll}
            className="shrink-0 rounded-md border border-border-subtle px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-accent-red/50 hover:text-accent-red"
          >
            Clear all
          </button>
        )}
      </div>

      {records.length === 0 && (
        <p className="rounded-xl border border-dashed border-border-subtle bg-surface p-6 text-center text-sm text-foreground-dim">
          No real-world signals observed yet. Drive a route to start learning.
        </p>
      )}

      {records.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
          {records.map((r) => (
            <li key={r.signalId} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-xs text-foreground">{r.signalId}</span>
                  {r.timingModel ? (
                    <span className="shrink-0 rounded-full bg-accent-green/10 px-2 py-0.5 text-[10px] font-medium text-accent-green">
                      {Math.round(r.timingModel.confidence * 100)}% confidence
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-dashed border-foreground-dim px-2 py-0.5 text-[10px] font-medium text-foreground-dim">
                      LEARNING
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-foreground-dim">
                  {r.lat.toFixed(5)}, {r.lng.toFixed(5)} · {r.observationCount} observation{r.observationCount === 1 ? "" : "s"} · last
                  seen {timeAgo(r.lastObservedAt)}
                </p>
                {r.timingModel && (
                  <p className="mt-0.5 font-mono text-[11px] text-foreground-muted">
                    cycle {formatDuration(r.timingModel.cycleSec)} · green {r.timingModel.greenSec}s · red {r.timingModel.redSec}s ·
                    offset {r.timingModel.offsetSec.toFixed(1)}s
                  </p>
                )}
              </div>
              <button
                onClick={() => handleDelete(r.signalId)}
                className="shrink-0 rounded-md border border-border-subtle px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:border-accent-red/50 hover:text-accent-red"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
