const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadHtml } = require('./harness');
const standalone = path.join(__dirname, '..', 'dp-latency-trace.html');
const htmlPath = process.env.DP_HTML || (fs.existsSync(standalone) ? standalone : path.join(__dirname, '..', 'dp-latency-trace', 'index.html'));
const { api, elements } = loadHtml(htmlPath);
const parse = line => api.parseExtLine('ExtLatency: '+line+' [http://example.invalid/test]').entries;
const txn = line => api.computeExtTxn(parse(line));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
function validate(t) {
  near(t.rows.reduce((s,r)=>s+r.duration,0),t.total);
  near(t.phaseTotals.Request+t.phaseTotals.Response,t.total);
  t.rows.forEach((r,i)=> {
    near(r.start,i?t.rows[i-1].end:0);
    near(r.end-r.start,r.duration);
    assert.ok(r.duration>=0 && r.end<=t.total);
    assert.equal(r.adjusted,r.rawEnd!==r.end);
  });
}
const reportedEquivalent='TS=0,HR=0,BR=0,PS=13,PC=18,CS=450,HS=450,BS=18, == HR=450,BR=450,PS=457,PC=462,BS=462,TC=462';
const sample=txn(reportedEquivalent);
validate(sample);
assert.equal(sample.total,462);
assert.equal(sample.rows.find(r=>r.phase==='Response'&&r.key==='HR').duration,0);
assert.equal(sample.rows.find(r=>r.key==='CS').duration,432);
assert.equal(sample.normalizationCount,1);
assert.equal(sample.rows.find(r=>r.key==='BS').rawEnd,18);
assert.equal(sample.rows.find(r=>r.key==='BS').end,450);
assert.equal(sample.rawTC,462);
assert.equal(sample.tcMismatch,false);

const edgeCases=[
  'TS=0,PC=18,BS=450, == HR=18,BR=450,TC=462', // phase-boundary regression
  'TS=0,PC=18,BS=450, == HR=450,PS=457,AXF=450,PC=462,TC=462',
  'TS=0,PS=18,APRB=0,CS=450,BS=0, == HR=0,BR=462,TC=462',
  'TS=0,BR=462,TC=450',
  'TS=0,BR=462,TC=0',
  'TS=0,TC=450,APRB=462',
  'TS=0,BR=5', // partial record: preserve existing support; no invented TC
  'TS=0,HR=0,BS=0,TC=0',
  'TS=2,HR=2,PC=4,TC=7',
  'TS=0,PS=0.1,AXF=0.05,PC=0.3,TC=0.3',
  'HR=0,AXF=1,AXF=2, == HR=3,AXF=4,TC=5',
];
edgeCases.forEach(line=>validate(txn(line)));
assert.equal(api.parseExtLine('ExtLatency: TS=0,APRB=-2,PC=4,TC=4'),null,'negative elapsed input rejected');
validate(api.computeExtTxn([{key:'TS',value:0,phase:'Request'},{key:'APRB',value:-2,phase:'Request'},{key:'TC',value:4,phase:'Request'}]));
const conflict=txn('TS=0,BR=462,TC=450');
assert.equal(conflict.total,462);
assert.equal(conflict.rawTotal,450);
assert.equal(conflict.rawTC,450);
assert.equal(conflict.totalAdjusted,true);
assert.equal(conflict.tcMismatch,true);
assert.equal(txn('TS=0,TC=450,APRB=462').tcMismatch,true);
assert.equal(txn('TS=0,BR=5').rawTC,null);
assert.deepEqual(Array.from(txn(edgeCases.at(-1)).rows.filter(r=>r.key==='AXF'),r=>r.occurrence),[1,2,3]);
const policy=txn('TS=0,J2X=5,X2J=9,rPC=9,TC=10');
assert.deepEqual(Array.from(policy.rows,r=>r.key),['TS','J2X','X2J','rPC','TC'],'documented alphanumeric policy keys must not be dropped');
assert.deepEqual(Array.from(policy.rows,r=>r.duration),[0,5,4,0,1]);
assert.equal(policy.rows[1].label,'JSON to XML policy');
assert.equal(policy.rows[2].label,'XML to JSON policy');
assert.equal(policy.rows[3].label,null,'keys without a documented definition remain unrecognized');
validate(policy);

// Metamorphic tests: inserting backward-valued unknown events into a known
// monotonic timeline must contribute zero elapsed time, leave all original
// event intervals unchanged, and preserve the overall transaction total.
let seed=0x20462;
const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
for(let i=0;i<100;i++) {
  let clock=0;
  const base=['TS','HR','BR','PS','PC','CS','HS','BS','HR','BR','PS','AXF','PC','BS','TC'].map((key,j)=>({key,value:clock+=j?random(501):0,phase:j<8?'Request':'Response'}));
  const baseline=api.computeExtTxn(base);
  const expanded=[];
  for(let j=0;j<base.length;j++) {
    expanded.push({...base[j]});
    if(j<base.length-1 && j%3===i%3)expanded.push({key:'MYSTERY',value:base[j].value-random(base[j].value+1),phase:base[j].phase});
  }
  const before=JSON.stringify(expanded);
  const result=api.computeExtTxn(expanded);
  assert.equal(JSON.stringify(expanded),before,'input entries unchanged');
  validate(result);
  assert.equal(result.total,baseline.total);
  const originals=result.rows.filter(r=>r.key!=='MYSTERY');
  assert.deepEqual(Array.from(originals,r=>[r.key,r.phase,r.occurrence,r.start,r.end,r.duration]),Array.from(baseline.rows,r=>[r.key,r.phase,r.occurrence,r.start,r.end,r.duration]));
  result.rows.filter(r=>r.key==='MYSTERY').forEach(r=>{assert.equal(r.duration,0);assert.equal(r.label,null);});
}

elements.get('raw').value='ExtLatency: '+reportedEquivalent;
elements.get('parse-btn').click();
let rendered=elements.get('main-panel').innerHTML;
assert.match(rendered,/raw 18/);
assert.match(rendered,/out-of-order timestamp/);
assert.doesNotMatch(rendered,/Verify transaction completion/);
assert.equal((rendered.match(/class="segment/g)||[]).length,5,'only positive intervals draw bars');
elements.get('raw').value='ExtLatency: TS=0,BR=462,TC=450';
elements.get('parse-btn').click();
assert.match(elements.get('main-panel').innerHTML,/raw TC \(450 ms\)/);
assert.match(elements.get('main-panel').innerHTML,/Verify transaction completion/);
elements.get('batch-raw').value='ExtLatency: '+reportedEquivalent;
elements.get('analyze-btn').click();
assert.match(elements.get('main-panel').innerHTML,/1 enhanced transaction\(s\)/);
elements.get('sample-ext-btn').click();
assert.doesNotMatch(elements.get('main-panel').innerHTML,/out-of-order timestamp/);
console.log('ExtLatency regression passed: backward timestamps, TC conflicts, phases, repeated/unknown keys, fractions, zero values, 100 insertion-invariance cases, and UI diagnostics');
