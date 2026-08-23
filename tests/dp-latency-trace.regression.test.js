const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "dp-latency-trace", "index.html");

function makeElement() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    style: {},
    files: [],
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    appendChild() {},
    remove() {},
    click() {},
    querySelectorAll() { return []; },
    getAttribute() { return null; },
    setAttribute() {},
  };
}

function loadHarness() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const scriptMatch = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(scriptMatch, "HTML must contain one inline script block");

  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement() { return makeElement(); },
    body: makeElement(),
    querySelectorAll() { return []; },
  };

  const window = {
    document,
    FileReader: function FileReader() {},
    Blob: function Blob() {},
    URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
  };

  const context = vm.createContext({
    window,
    document,
    console,
    FileReader: window.FileReader,
    Blob: window.Blob,
    URL: window.URL,
  });

  vm.runInContext(scriptMatch[1], context, { filename: "dp-latency-trace.html" });
  return window.DpLatencyTraceTest;
}

const api = loadHarness();

const standardLine = "Thu Jan 01 2026 00:00:00 [latency][info] mpgw(TEST): tid(1) gtid(test-1): Latency: 0 508 0 508 508 0 0 512 756 512 756 756 512 512 508 508 [http://example.invalid/test]";
const extendedLine = "Thu Jan 01 2026 00:00:00 [extlatency][info] mpgw(TEST): tid(1) gtid(test-1): ExtLatency: TS=0,HR=0,BR=0,PS=0,APRB=0,ASLM=0,AXF=0,AGS=508,ARE=508,PC=508,CS=508,HS=508,BS=508, == HR=512,BR=512,PS=512,APRB=512,AXF=512,AGS=756,AGS=756,ARE=756,PC=756,HS=756,BS=756,TC=756, [http://example.invalid/test]";
const syntheticMixedLog = [
  standardLine,
  extendedLine,
  "Thu Jan 01 2026 00:00:01 [latency][info] mpgw(TEST): tid(2) gtid(test-2): Latency: 0 100 0 100 100 0 0 104 250 104 250 250 104 104 100 100 [http://example.invalid/test]",
  "Thu Jan 01 2026 00:00:01 [extlatency][info] mpgw(TEST): tid(2) gtid(test-2): ExtLatency: TS=0,HR=0,BR=0,PS=0,APRB=0,AGS=100,ARE=100,PC=100,CS=100,HS=100,BS=100, == HR=104,BR=104,PS=104,APRB=104,AXF=104,AGS=249,ARE=249,PC=249,HS=249,BS=249,TC=249, [http://example.invalid/test]",
  "Thu Jan 01 2026 00:00:02 [latency][info] mpgw(TEST): tid(3) gtid(test-3): Latency: 0 120 0 120 120 0 0 124 300 124 300 300 124 124 120 120 [http://example.invalid/test]",
  "Thu Jan 01 2026 00:00:02 [extlatency][info] mpgw(TEST): tid(3) gtid(test-3): ExtLatency: TS=0,HR=0,BR=0,PS=0,APRB=0,AGS=120,ARE=120,PC=120,CS=120,HS=120,BS=120, == HR=124,BR=124,PS=124,APRB=124,AXF=124,AGS=300,ARE=300,PC=300,HS=300,BS=300,TC=300, [http://example.invalid/test]",
].join("\n");

const standardRaw = api.parseStdLine(standardLine);
assert.equal(standardRaw.length, 16, "standard Latency parser must read 16 positional fields");
assert.deepEqual(
  Array.from(standardRaw),
  [0, 508, 0, 508, 508, 0, 0, 512, 756, 512, 756, 756, 512, 512, 508, 508],
  "standard field extraction must preserve IBM positional order input values",
);

const standardTxn = api.computeStdTxn(standardRaw);
assert.equal(standardTxn.total, 756, "standard total must be the final cumulative logical timestamp");
assert.equal(standardTxn.bottleneckGroup, "Request Processing", "standard sample bottleneck group");
assert.equal(
  standardTxn.rows.reduce((sum, row) => sum + row.duration, 0),
  standardTxn.total,
  "standard stage durations must be cumulative deltas, not summed raw fields",
);

const extendedParsed = api.parseExtLine(extendedLine);
assert.ok(extendedParsed.entries.some(entry => entry.key === "APRB"), "unknown ExtLatency keys must be retained");
const extendedTxn = api.computeExtTxn(extendedParsed.entries);
assert.equal(extendedTxn.total, 756, "ExtLatency total must use final cumulative TC value");
assert.ok(
  extendedTxn.rows.some(row => row.key === "APRB" && row.label === null),
  "unknown ExtLatency keys must not be guessed",
);
assert.equal(
  extendedTxn.rows.reduce((sum, row) => sum + row.duration, 0),
  extendedTxn.total,
  "ExtLatency action durations must be cumulative deltas",
);

const parsedLog = api.parseLogRecords(syntheticMixedLog);
assert.equal(parsedLog.std.length, 3, "synthetic mixed log standard Latency count");
assert.equal(parsedLog.ext.length, 3, "synthetic mixed log ExtLatency count");

const crossFormat = api.compareCrossFormat(parsedLog.std, parsedLog.ext);
assert.deepEqual(
  {
    pairCount: crossFormat.pairCount,
    exact: crossFormat.exact,
    withinOne: crossFormat.withinOne,
    beyondOne: crossFormat.beyondOne,
    maxDelta: crossFormat.maxDelta,
    unpaired: crossFormat.unpaired,
  },
  { pairCount: 3, exact: 2, withinOne: 1, beyondOne: 0, maxDelta: 1, unpaired: 0 },
  "mixed logs should compare standard totals with ExtLatency TC and tolerate only known 1 ms jitter",
);

const html = fs.readFileSync(htmlPath, "utf8");
assert.equal(/fonts\.googleapis|fonts\.gstatic/i.test(html), false, "HTML must not call external font services");

console.log("Regression tests passed");
