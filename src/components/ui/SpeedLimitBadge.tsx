import { roundMph } from "@/lib/geo/units";

export function SpeedLimitBadge({ speedLimitMps }: { speedLimitMps: number }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-foreground/70 bg-surface px-3 py-1.5">
      <span className="text-[9px] font-semibold leading-none tracking-wide text-foreground-muted">LIMIT</span>
      <span className="tabular-num text-xl font-bold leading-tight">{roundMph(speedLimitMps)}</span>
    </div>
  );
}

export function DataSourceBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border-subtle bg-surface px-2.5 py-1 text-[10px] font-medium tracking-[0.1em] text-foreground-dim">
      {label}
    </span>
  );
}
