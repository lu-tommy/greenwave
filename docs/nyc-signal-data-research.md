# NYC Signal Data Research

Investigation into legitimate sources of real traffic-signal **location** and **timing** data for the New York City area, as of September 2026. This is research, not an integration — Green Wave does not connect to any of the sources below. See [signal-intelligence.md](./spat-compatibility.md) for how a future feed would plug into the architecture without a rewrite.

**Bottom line: no source below is both live and openly/immediately usable today.** The app is architected around that reality (`SignalSource: "UNKNOWN"` is a normal, expected state), not around finding one.

## Sources investigated

### 1. NYC Open Data (data.cityofnewyork.us)

- **What it has:** a "Traffic Signal and All-Way Stop Study Requests" dataset — a tracking system for maintenance/study *requests*, not signal phase or timing parameters. General traffic-speed sensor datasets ("DOT Traffic Speeds") also exist but describe vehicle speeds, not signal state.
- **Live?** No. **Timing/phase data?** No — no dataset was found containing cycle length, phase splits, or offsets for individual signals.
- **Cost / authorization:** Free, no authorization — but doesn't contain what we need.
- **Usable now?** No — not the right kind of data.

### 2. NYC DOT Connected Vehicle Pilot Deployment (CVPD)

- NYC DOT ran one of three original USDOT Connected Vehicle Pilot sites (alongside Tampa and Wyoming), broadcasting real SAE J2735 SPaT/MAP/TIM messages from roadside units to equipped vehicles.
- Event-log data captured by pilot vehicles (including SPaT/MAP messages "as heard by the host vehicle") was delivered to the USDOT **ITS DataHub** for research use, with privacy filtering/anonymization per the program's Data Management Plan.
- **Live?** No — this is **archival pilot data** from a completed deployment, not a live feed.
- **Coverage:** A defined pilot corridor/intersection set in Manhattan during the pilot period, not citywide, not current.
- **Cost / authorization:** Described as open research data via the ITS DataHub / data.gov, though CV Pilot datasets typically require following ITS JPO's data access process (registration, and a Data Use Agreement for anything with privacy-sensitive content).
- **Usable now?** Not for live guidance. Potentially interesting as **replay fixture material** for validating the SPaT ingestion/replay pipeline (see `src/lib/signalIntelligence/spatIngestion.ts`) — a genuine future step, not attempted in this pass since it needs the DUA process and data-shape verification first.
- C2SMART (a USDOT University Transportation Center at NYU Tandon) has published pilot-related research and may be a useful contact for academic-access questions.

### 3. USDOT ITS DataHub (general)

- Hosts open CV Pilot datasets from multiple sites; the Tampa pilot's SPaT message dataset is explicitly documented as available. NYC pilot data is referenced similarly (see #2).
- **Live?** No — archival research datasets.
- **Usable now?** Same caveats as #2 — a research/fixture source, not a live feed.

### 4. USDOT V2X Hub (open-source software)

- An open-source project (`usdot-fhwa-OPS/V2X-Hub` on GitHub) that a *traffic agency* runs to translate its controllers' NTCIP 1202 output into broadcast SAE J2735 SPaT messages.
- **This is infrastructure software, not a data source** — useful to us only as a reference for validating that our normalized SPaT types (`SpatIntersectionState`/`SpatSignalGroup`/`SpatEvent`) are shaped compatibly with what a real V2X Hub deployment would emit. See `docs/spat-compatibility.md`.
- **Usable now?** No — NYC DOT would need to run something like this and expose a feed; nothing here for a consumer app to connect to.

### 5. Traffic Technology Services (TTS) — Personal Signal Assistant®

- A commercial product providing predictive SPaT-derived data for GLOSA and red-light countdown (the product this project studies as a UX/architecture reference — see README).
- Integration is described as working through partnerships with ATMS vendors and OEMs, not a public self-serve developer signup or sandbox.
- **Usable now?** No — no public developer access path found. `ExternalLiveSignalIntelligenceProvider` exists as the extension point if a commercial relationship like this is ever pursued.

### 6. Direct request to NYC DOT (FOIL)

- New York's Freedom of Information Law is a plausible path to *static* published timing plans (not live SPaT) for specific corridors, but this is untested — no request has been filed as part of this project, and outcome/format/cost are unknown.
- **Usable now?** Unverified.

## Summary table

| Source | Live? | Coverage | Cost/Auth | Usable now? |
|---|---|---|---|---|
| NYC Open Data | No | N/A (wrong data) | Free | No |
| NYC CV Pilot / ITS DataHub | No (archival) | Historical, Manhattan pilot corridor | Free, DUA likely required | No (possible future replay fixture) |
| USDOT V2X Hub | N/A (software) | N/A | Open source | No (reference only) |
| TTS Personal Signal Assistant | Yes (commercial) | Wherever TTS has ATMS integration | Commercial, vendor-gated | No |
| NYC DOT FOIL request | No (static, if granted) | Unknown | Unknown | Unverified |

## What this means for Green Wave

The architecture (`SignalIntelligenceProvider`, `SignalIntelligenceEngine`, confidence tiers, freshness rules) does not assume any of the above will materialize. `StaticSignalTimingProvider`/`ManualSignalTimingProvider`/`LearnedSignalTimingProvider` are what actually run today; `SpatSignalTimingProvider` is real and tested against replayed fixtures (see `spatIngestion.test.ts`, `spatReplay.test.ts`) but has nothing live to ingest; `ExternalLiveSignalIntelligenceProvider` and `OfficialStaticSignalIntelligenceProvider` are typed extension points with no implementation, honestly.

**Sources:**
- [Traffic Signal and All-Way Stop Study Requests — NYC Open Data](https://data.cityofnewyork.us/Transportation/Traffic-Signal-and-All-Way-Stop-Study-Requests/w76s-c5u4)
- [NYC DOT Data Feeds, Dashboards & Open Data](https://www.nyc.gov/html/dot/html/about/datafeeds.shtml)
- [NYC Connected Vehicle Pilot — C2SMART](https://c2smart.engineering.nyu.edu/nyc-connected-vehicle-pilot/)
- [New York City Connected Vehicle Pilot data now available — Traffic Technology Today](https://www.traffictechnologytoday.com/news/its/new-york-city-connected-vehicle-pilot-data-now-available.html)
- [Connected Vehicle Pilot Deployment Program Phase 2, Data Management Plan — New York City](https://rosap.ntl.bts.gov/view/dot/35363)
- [ITS DataHub — ITS JPO Open Data Portal](https://www.its.dot.gov/data/)
- [V2X Hub — usdot-fhwa-OPS (GitHub)](https://github.com/usdot-fhwa-OPS/V2X-Hub)
- [V2X Hub Layer 2 documentation — Confluence](https://usdot-oss4its.atlassian.net/wiki/spaces/OSSFITS/pages/312737826/V2X+Hub+Layer+2)
- [Personal Signal Assistant — Traffic Technology Services](https://www.traffictechservices.com/personalsignalassistant.html)
- [Personal Signal Assistant FAQ — TTS](https://www.supplier-traffictechservices.com/personal_signal_assistant_faq.html)
