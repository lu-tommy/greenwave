import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { SafetyDisclaimer } from "@/components/ui/SafetyDisclaimer";

const SECONDARY_ACTIONS = [
  {
    href: "/simulator",
    title: "Simulator",
    description: "Watch a virtual vehicle drive a coordinated corridor and compare optimized vs. normal driving.",
  },
  {
    href: "/calibration",
    title: "Calibration",
    description: "Inspect real-world signal knowledge and the demo corridor's manually-defined timing.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <NavBar />
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16 text-center">
        <div className="flex max-w-xl flex-col items-center gap-4">
          <span className="rounded-full border border-border-subtle bg-surface px-3 py-1 text-[11px] font-medium tracking-[0.1em] text-foreground-dim">
            SIGNAL TIMING LEARNED FROM YOUR DRIVES
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Green Wave</h1>
          <p className="text-base leading-relaxed text-foreground-muted">
            Enter a destination and Green Wave finds the route, locates the traffic signals along it, and gives you
            a legal, smooth speed to catch as many greens as the data supports — clearly marking what it doesn&apos;t
            know yet.
          </p>
        </div>

        <Link
          href="/drive"
          className="w-full max-w-sm rounded-xl bg-accent-green px-6 py-4 text-base font-semibold text-background transition-opacity hover:opacity-90"
        >
          Where are you going?
        </Link>

        <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
          {SECONDARY_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent-blue/40 hover:bg-surface-raised"
            >
              <span className="text-sm font-semibold text-foreground">{action.title}</span>
              <span className="text-xs leading-relaxed text-foreground-muted">{action.description}</span>
            </Link>
          ))}
        </div>

        <SafetyDisclaimer />
      </main>
    </div>
  );
}
