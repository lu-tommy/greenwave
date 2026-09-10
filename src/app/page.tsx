import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { SafetyDisclaimer } from "@/components/ui/SafetyDisclaimer";

const ACTIONS = [
  {
    href: "/simulator",
    title: "Simulator",
    description: "Watch a virtual vehicle drive a coordinated corridor and compare optimized vs. normal driving.",
  },
  {
    href: "/drive",
    title: "Drive Mode",
    description: "Use live GPS to get real-time speed guidance as you approach a selected corridor.",
  },
  {
    href: "/calibration",
    title: "Calibration",
    description: "Inspect and edit the manually-defined signal timing behind the demo corridor.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
      <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16 text-center">
        <div className="flex max-w-xl flex-col items-center gap-4">
          <span className="rounded-full border border-border-subtle bg-surface px-3 py-1 text-[11px] font-medium tracking-[0.1em] text-foreground-dim">
            V1 · SIMULATED SIGNAL DATA
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Green Wave</h1>
          <p className="text-base leading-relaxed text-foreground-muted">
            A consumer Green Light Optimal Speed Advisory concept. It predicts upcoming signal phases along a
            corridor and recommends the legal speed most likely to catch a sequence of greens, smoothly.
          </p>
        </div>

        <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          {ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-5 text-left transition-colors hover:border-accent-blue/40 hover:bg-surface-raised"
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
