import type { SignalIntelligenceProvider, SignalTimingEvidence } from "@/lib/types";

/**
 * Extension points, not fake implementations. Neither of these is wired to
 * any real feed — they exist so the fusion engine's provider list,
 * precedence, and confidence/freshness handling are exercised and ready
 * for a real integration without restructuring anything. Wiring one in
 * later means implementing `getTiming`, not changing the engine.
 */

/** No third-party live signal-timing service (e.g. a licensed feed) is integrated. */
export class ExternalLiveSignalIntelligenceProvider implements SignalIntelligenceProvider {
  async getTiming(): Promise<SignalTimingEvidence | null> {
    return null;
  }
}

/** No published, authoritative static timing plan source is integrated — see docs/nyc-signal-data-research.md. */
export class OfficialStaticSignalIntelligenceProvider implements SignalIntelligenceProvider {
  async getTiming(): Promise<SignalTimingEvidence | null> {
    return null;
  }
}
