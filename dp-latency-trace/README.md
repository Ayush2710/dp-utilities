# DP Latency Trace

Single-file, client-side IBM DataPower `Latency:` and `ExtLatency:` analyzer for gateway/API teams.

Open `index.html` in this folder, paste a single record or load a `.log`/`.txt` file, and review the latency breakdown locally. No backend is used and log data is not uploaded.

## What It Does

- Parses standard `Latency:` records with the IBM-documented 16-field logical order.
- Parses enhanced `ExtLatency:` records as separate `KEY=VALUE` request/response timelines.
- Treats all timestamp values as cumulative milliseconds from transaction start.
- Standard timelines use `displayEnd = max(previousDisplayEnd, rawTimestamp)`, then subtract the previous display end. This matches dpShowLatency and prevents duplicate elapsed time after a backward timestamp.
- Standard rows retain raw timestamps and flag adjusted display times; a conflicting final timestamp is explicitly flagged for review.
- Extended timelines also keep elapsed time from moving backward. They preserve recorded key order, repeated keys, request/response phases and raw values, and flag conflicting completion timestamps.
- Keeps unknown enhanced-latency keywords visible by raw key instead of guessing.
- Supports mixed logs containing both `Latency:` and `ExtLatency:` records.
- Shows batch summaries, percentiles, waterfall views, histogram, timeline, expandable transaction rows, CSV export, and cross-format validation.

## Verified Parsing Semantics

Standard `Latency:` fields are interpreted in this logical order:

`1, 3, 7, 6, 4, 15, 16, 2, 5, 8, 10, 14, 13, 11, 9, 12`

The tool deliberately does not sum the 16 raw standard fields. Standard totals use the final nondecreasing display timestamp (the maximum observed timestamp). For validated records this equals raw position 12. Streaming can change event order, so adjusted stage intervals are display allocations, not proof of exact event timing.

The mapping and streaming caveat are documented in [IBM Latency messages](https://www.ibm.com/docs/en/datapower-gateway/10.6.x?topic=troubleshooting-latency-messages). The normalization behavior was checked against the [live dpShowLatency tool](https://pglezen.github.io/dpShowLatency/ShowLatency.html).

`ExtLatency:` is not parsed as a variant of the 16-field format. It is parsed as comma-separated `KEY=VALUE` pairs split by `==`, with request and response phases kept separate.

For an out-of-order enhanced timestamp, the display cursor stays at its previous maximum and the raw value remains visible. The cursor continues across `==`; phases are not independent clocks. If the final timestamp or a recorded `TC` conflicts with the observed maximum, the UI warns that transaction completion needs verification. Adjusted intervals are display allocations rather than proof of exact action durations.

## Regression Test

The repo test suite uses synthetic `Latency:` and `ExtLatency:` records so no production-style logs need to be published. It checks:

- Standard 16-field extraction.
- IBM logical field order.
- Cumulative-delta duration calculation.
- Separate ExtLatency key/value parsing.
- Unknown keyword preservation.
- Mixed-log parsing and cross-format total comparison.
- No external font service calls.
- All 16 displayed timestamps and durations for 100 cases captured from the live original website, including interior and terminal regressions.
- Timeline continuity, stage/group sums, raw-value preservation, and normalization warnings.
- Enhanced regressions across phases, repeated/unknown keywords, conflicting TC, zero/fractional values, and 100 insertion-invariance cases.

Run:

```bash
npm test
```

The tests are dependency-free and use Node.js only.

## GitHub Pages

This is hosted as a static GitHub Pages folder:

`https://ayush2710.github.io/dp-utilities/dp-latency-trace/`

Do not commit real production/customer logs. The included `.gitignore` excludes `*.log` files because the tool runs locally in the browser, but repository contents and GitHub Pages assets are public when the repository is public.
