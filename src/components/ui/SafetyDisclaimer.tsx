export function SafetyDisclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] leading-snug text-foreground-dim ${className}`}>
      Advisory only — obey traffic laws and roadway conditions.
    </p>
  );
}
