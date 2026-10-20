const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadHtml } = require('./harness');
const standalone = path.join(__dirname,'..','dp-latency-trace.html');
const htmlPath = process.env.DP_HTML || (fs.existsSync(standalone) ? standalone : path.join(__dirname,'..','dp-latency-trace','index.html'));
const { api, elements } = loadHtml(htmlPath);
const fixture = require('./fixtures/dpshowlatency-live.json');
const order = [1,3,7,6,4,15,16,2,5,8,10,14,13,11,9,12];
assert.equal(fixture.cases.length,100);
assert.ok(fixture.capturedOn, 'expected outputs must have been captured from the live site');

function validate(txn) {
  assert.equal(txn.rows.reduce((s,r)=>s+r.duration,0),txn.total,'stage sum = total');
  assert.equal(Object.values(txn.groupTotals).reduce((a,b)=>a+b,0),txn.total,'group sum = total');
  txn.rows.forEach((r,i) => {
    assert.equal(r.position,order[i],'IBM field mapping');
    assert.equal(r.start,i ? txn.rows[i-1].end : 0,'contiguous timeline');
    assert.equal(r.duration,r.end-r.start);
    assert.ok(r.duration>=0 && r.end<=txn.total);
    assert.equal(r.adjusted,r.end!==r.rawEnd);
  });
}
for (const c of fixture.cases) {
  assert.equal(c.observed.length,16,`${c.id}: complete live oracle`);
  const raw = api.parseStdLine('Latency: '+c.raw.join(' ')+' [http://example.invalid/test]');
  const snapshot = Array.from(raw);
  const txn = api.computeStdTxn(raw);
  assert.deepEqual(Array.from(txn.rows,r=>({end:r.end,duration:r.duration})),c.observed,`${c.id}: all stages match live dpShowLatency`);
  assert.deepEqual(Array.from(raw),snapshot,'raw input is not mutated');
  assert.deepEqual(Array.from(txn.rows,r=>r.rawEnd),order.map(p=>c.raw[p-1]));
  assert.equal(txn.rawTotal,c.raw[11]);
  assert.equal(txn.totalAdjusted,txn.total!==txn.rawTotal);
  validate(txn);
}
const sample = api.computeStdTxn(fixture.cases[0].raw);
assert.equal(sample.total,462);
assert.equal(sample.bottleneckGroup,'Backside Transmit');
assert.equal(sample.bottleneckDur,432);
assert.equal(sample.groupTotals['Receive Response Headers'],0);
assert.equal(sample.normalizationCount,1);
assert.equal(sample.rows[8].rawEnd,18);
assert.equal(sample.rows[8].end,450);

// Exercise the rendered single-record flow, including honest raw values and
// a separate warning when a final timestamp conflicts with an earlier event.
elements.get('raw').value = 'Latency: '+fixture.cases[0].raw.join(' ');
elements.get('parse-btn').click();
assert.match(elements.get('main-panel').innerHTML,/raw 18/);
assert.match(elements.get('main-panel').innerHTML,/1 out-of-order timestamp/);
assert.equal((elements.get('main-panel').innerHTML.match(/class="segment/g)||[]).length,3,'only positive-duration groups draw bars');
const terminalCase = fixture.cases.find(c=>c.kind==='terminal regression');
elements.get('raw').value = 'Latency: '+terminalCase.raw.join(' ');
elements.get('parse-btn').click();
assert.match(elements.get('main-panel').innerHTML,/observed maximum; verify this record/);
elements.get('sample-std-btn').click();
assert.doesNotMatch(elements.get('main-panel').innerHTML,/out-of-order timestamp/);

console.log('100 live reference cases passed (1,600 stage comparisons), timeline invariants and rendering warnings passed');
module.exports = { validate };
