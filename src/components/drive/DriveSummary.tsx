"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistance, formatDuration } from "@/lib/geo/units";
import type { DrivePostSummary } from "@/lib/driveSession/DriveSessionRecorder";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="tabular-num text-xl font-semibold text-foreground">{value}</span>
      <span className="text-[10px] font-medium tracking-[0.08em] text-foreground-dim">{label}</span>
    </div>
  );
}

export function DriveSummary({
  summary,
  onExportDebugJson,
}: {
  summary: DrivePostSummary;
  onExportDebugJson: () => Promise<object>;
}) {
  const [exporting, setExporting] = useState(false);
  const { session, timingModelsImproved, newObservations } = summary;

  async function handleExport() {
    setExporting(true);
    try {
      const debugJson = await onExportDebugJson();
      const blob = new Blob([JSON.stringify(debugJson, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `greenwave-drive-${session.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 p-6 text-center">
      <div>
        <span className="text-sm font-semibold tracking-[0.15em] text-accent-green">DRIVE COMPLETE</span>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">{formatDistance(session.distanceM)}</h1>
        <p className="text-sm text-foreground-muted">{formatDuration(session.durationSec)}</p>
      </div>

      <div className="grid w-full max-w-sm grid-cols-3 gap-3 rounded-xl border border-border-subtle bg-surface p-4">
        <Stat label="SIGNALS" value={session.signalsEncountered} />
        <Stat label="STOPS" value={session.stops} />
        <Stat label="KNOWN TIMING" value={session.knownSignalsEncountered} />
      </div>

      <div className="grid w-full max-w-sm grid-cols-2 gap-3 rounded-xl border border-border-subtle bg-surface p-4">
        <Stat label="NEW OBSERVATIONS" value={newObservations} />
        <Stat label="MODELS IMPROVED" value={timingModelsImproved} />
      </div>

      <p className="max-w-sm text-xs leading-relaxed text-foreground-dim">
        Green Wave keeps learning this route. Drive it again and more signals should shift from Learning to Known.
      </p>

      <div className="flex w-full max-w-sm flex-col gap-2">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-foreground-dim disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export Drive Debug JSON"}
        </button>
        <Link
          href="/drive"
          className="rounded-lg bg-accent-green px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
        >
          Done
        </Link>
      </div>
    </div>
  );
}
