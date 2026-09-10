import Link from "next/link";

const LINKS = [
  { href: "/simulator", label: "Simulator" },
  { href: "/drive", label: "Drive Mode" },
  { href: "/calibration", label: "Calibration" },
];

export function NavBar() {
  return (
    <header className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5 pt-[max(env(safe-area-inset-top),0.875rem)]">
      <Link href="/" className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-accent-green" />
        <span className="text-sm font-semibold tracking-wide text-foreground">GREEN WAVE</span>
      </Link>
      <nav className="flex items-center gap-1">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
