# DP Latency Trace

Single-file, client-side IBM DataPower `Latency:` and `ExtLatency:` analyzer for gateway/API teams.

Open `index.html` in this folder, paste a single record or load a `.log`/`.txt` file, and review the latency breakdown locally. No backend is used and log data is not uploaded.

## What It Does

- Parses standard `Latency:` records with the IBM-documented 16-field logical order.
- Parses enhanced `ExtLatency:` records as separate `KEY=VALUE` request/response timelines.
- Treats all timestamp values as cumulative milliseconds from transaction start.
- Calculates each stage/action duration as `current cumulative value - previous cumulative value`.
- Clamps small negative calculated durations to `0 ms` to avoid clock-sampling noise.
- Keeps unknown enhanced-latency keywords visible by raw key instead of guessing.
- Supports mixed logs containing both `Latency:` and `ExtLatency:` records.
- Shows batch summaries, percentiles, waterfall views, histogram, timeline, expandable transaction rows, CSV export, and cross-format validation.

## Verified Parsing Semantics

Standard `Latency:` fields are interpreted in this logical order:

`1, 3, 7, 6, 4, 15, 16, 2, 5, 8, 10, 14, 13, 11, 9, 12`

The tool deliberately does not sum the 16 raw standard fields. The final total is the final cumulative logical timestamp after the IBM field-order mapping.

`ExtLatency:` is not parsed as a variant of the 16-field format. It is parsed as comma-separated `KEY=VALUE` pairs split by `==`, with request and response phases kept separate.

## Regression Test

The repo test suite uses synthetic `Latency:` and `ExtLatency:` records so no production-style logs need to be published. It checks:

- Standard 16-field extraction.
- IBM logical field order.
- Cumulative-delta duration calculation.
- Separate ExtLatency key/value parsing.
- Unknown keyword preservation.
- Mixed-log parsing and cross-format total comparison.
- No external font service calls.

Run:

```bash
npm test
```

The tests are dependency-free and use Node.js only.

## GitHub Pages

This is hosted as a static GitHub Pages folder:

`https://ayush2710.github.io/dp-utilities/dp-latency-trace/`

Do not commit real production/customer logs. The included `.gitignore` excludes `*.log` files because the tool runs locally in the browser, but repository contents and GitHub Pages assets are public when the repository is public.
