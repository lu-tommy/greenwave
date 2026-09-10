import { formatDistance, formatDuration } from "@/lib/geo/units";
import type { Corridor, Route } from "@/lib/types";

export type DiagnosticStatus = "ready" | "pending" | "unavailable";

export type PreDriveDiagnostics = {
  location: DiagnosticStatus;
  routing: DiagnosticStatus;
  route: DiagnosticStatus;
  gps: DiagnosticStatus;
  network: DiagnosticStatus;
};

const STATUS_LABEL: Record<DiagnosticStatus, string> = {
  ready: "READY",
  pending: "CHECKING…",
  unavailable: "UNAVAILABLE",
};

const STATUS_COLOR: Record<DiagnosticStatus, string> = {
  ready: "text-accent-green",
  pending: "text-foreground-dim",
  unavailable: "text-accent-amber",
};

function DiagnosticRow({ label, status }: { label: string; status: DiagnosticStatus }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-foreground-muted">{label}</span>
      <span className={`text-xs font-semibold tracking-wide ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</span>
    </div>
  );
}

export function RoutePreview({
  route,
  corridor,
  diagnostics,
  onStartDrive,
}: {
  route: Route;
  corridor: Corridor;
  diagnostics: PreDriveDiagnostics;
  onStartDrive: () => void;
}) {
  const total = corridor.intersections.length;
  const known = corridor.intersections.filter((i) => i.signalPlan != null).length;
  const learning = total - known;
  const isLearningDrive = total === 0 || known / total < 0.3;
  const allCriticalReady = diagnostics.location === "ready" && diagnostics.gps === "ready";

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border-subtle bg-surface p-5">
        <div className="flex items-center justify-between text-sm text-foreground-muted">
          <span>Current location</span>
          <span>→</span>
          <span className="font-medium text-foreground">{route.destinationLabel || "Destination"}</span>
        </div>
        <div className="mt-3 flex items-baseline gap-4">
          <span className="text-2xl font-semibold text-foreground">{formatDuration(route.durationSec)}</span>
          <span className="text-sm text-foreground-muted">{formatDistance(route.distanceM)}</span>
        </div>
      </div>

      <div className="rounded-xl border border-border-subtle bg-surface p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">{total} traffic signal{total === 1 ? "" : "s"} on route</span>
        </div>
        <div className="flex gap-6">
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-accent-green">{known}</span>
            <span className="text-[11px] tracking-wide text-foreground-dim">KNOWN</span>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-foreground-muted">{learning}</span>
            <span className="text-[11px] tracking-wide text-foreground-dim">LEARNING</span>
          </div>
        </div>
        {isLearningDrive && (
          <p className="mt-3 text-xs leading-relaxed text-foreground-dim">
            Timing is unavailable for much of this route. Green Wave will record observations and provide guidance
            only where confidence is sufficient — this will start as a Learning Drive.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border-subtle bg-surface p-5">
        <span className="mb-1 block text-[11px] font-medium tracking-[0.1em] text-foreground-dim">READINESS</span>
        <DiagnosticRow label="Location" status={diagnostics.location} />
        <DiagnosticRow label="Routing" status={diagnostics.routing} />
        <DiagnosticRow label="Route" status={diagnostics.route} />
        <DiagnosticRow label="Traffic signals" status={total > 0 ? "ready" : "unavailable"} />
        <DiagnosticRow label="GPS" status={diagnostics.gps} />
        <DiagnosticRow label="Network" status={diagnostics.network} />
      </div>

      <button
        onClick={onStartDrive}
        disabled={!allCriticalReady}
        className="rounded-xl bg-accent-green px-5 py-3.5 text-base font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isLearningDrive ? "START LEARNING DRIVE" : "START DRIVE"}
      </button>
    </div>
  );
}
