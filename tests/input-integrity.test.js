const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadHtml} = require('./harness');
const standalone=path.join(__dirname,'..','dp-latency-trace.html');
const html=process.env.DP_HTML || (fs.existsSync(standalone)?standalone:path.join(__dirname,'..','dp-latency-trace','index.html'));
const {api,elements}=loadHtml(html);
const std=n=>'Latency: '+Array(16).fill(n).join(' ');
const meta=(id,scope='')=>`${scope} mpgw(test): tid(${id}) gtid(g-${id}): `;
const pair=(s,e)=>{const p=api.parseLogRecords([s,e].join('\n'));return api.compareCrossFormat(p.std,p.ext);};
const result=s=>{elements.get('raw').value=s;elements.get('parse-btn').click();return elements.get('main-panel').innerHTML;};

// F1/F2: never discard a suffix, take numbers from metadata, or drop a bad token.
const rejected=[
  'ExtLatency: TS=0,PC=10, == HR=20, == BS=90,TC=100',
  'ExtLatency: TS=0, == == TC=100',
  'ExtLatency: TS=0,==', 'ExtLatency: ==TC=10',
  'ExtLatency: TS=0,,TC=10', 'ExtLatency: TS=0,TC=10,,',
  'ExtLatency: TS=0,AGS=bad,TC=100',
  'ExtLatency: TS=0,AGS=-1,TC=100',
  'ExtLatency: TS=0,TC=Infinity', 'ExtLatency: TS=0,TC=1e3',
  'ExtLatency: TS=0,TC=9007199254740992',
  'ExtLatency: TS=0,TC=10 garbage',
  'ExtLatency: TS=0,TC=10 [http://example.invalid] trailing',
  'ExtLatency: TS=0,TC=10 [http://example.invalid',
  'ExtLatency: TS=0,TC=10\nExtLatency: TS=0,TC=20',
];
rejected.forEach(s=>assert.equal(api.parseExtLine(s),null,s));
const badStandard=[
  'Latency: '+Array(15).fill(0).join(' ')+' [http://192.168.1.24:8082/request5]',
  std(0)+' 17', std(0).replace('Latency: 0','Latency: BAD123'),
  std(0).replace('Latency: 0','Latency: -1'),
  std(0).replace('Latency: 0','Latency: 1e3'),
  std(0)+' [http://example.invalid] 50', std(0)+'\n'+std(1),
];
badStandard.forEach(s=>assert.equal(api.parseStdLine(s),null,s));
assert.equal(api.parseStdLine(std(0)+' [http://example.invalid/?q=ExtLatency:]').length,16);
assert.equal(api.parseExtLine('ExtLatency: HR=0,AXF=1,AXF=2, == HR=3,TC=4, [mq://example.invalid/queue]').entries.length,5);
assert.equal(api.parseExtLine('ExtLatency: TS=0,J2X=0.5,X2J=1,UNKNOWN=2,TC=3,').entries.length,5);
const inherited=api.computeExtTxn(api.parseExtLine('ExtLatency: TS=0,constructor=1,TC=2').entries);
assert.equal(inherited.rows[1].label,null);assert.equal(inherited.rows[1].occurrence,1);
result('ExtLatency: TS=0,TC=100');
result(rejected[0]);
assert.match(elements.get('error-box').textContent,/Multiple ==/);
assert.doesNotMatch(elements.get('main-panel').innerHTML,/100 ms/,'failed parse clears prior results');
const mixed=[meta(1)+std(10),rejected[0],badStandard[0],'unrelated line',' == TC=100'].join('\n');
const diagnostic=api.parseLogRecords(mixed);
assert.equal(diagnostic.std.length,1);assert.equal(diagnostic.ext.length,0);
assert.deepEqual(Array.from(diagnostic.rejected,r=>r.line),[2,3]);
assert.equal(diagnostic.continuations[0].line,5);assert.equal(diagnostic.ignored,1);
elements.get('batch-raw').value=mixed;elements.get('analyze-btn').click();
assert.match(elements.get('main-panel').innerHTML,/2 rejected record\(s\); 1 unassigned/);
assert.match(elements.get('main-panel').innerHTML,/Line 2:/);
elements.get('batch-raw').value=rejected[0];elements.get('analyze-btn').click();
assert.match(elements.get('main-panel').innerHTML,/1 rejected/);
assert.doesNotMatch(elements.get('main-panel').innerHTML,/Transactions<\/div>/,'all-invalid batch clears previous summary');

// F3: totals cannot determine pair identity or completion eligibility.
const ordered=[meta('a')+std(100),meta('b')+std(200),meta('b')+'ExtLatency: TS=0,TC=200',meta('a')+'ExtLatency: TS=0,TC=100'].join('\n');
const p=api.parseLogRecords(ordered);const matched=api.compareCrossFormat(p.std,p.ext);
assert.equal(matched.pairCount,2);assert.equal(matched.compared,2);assert.equal(matched.exact,2);assert.equal(matched.beyondOne,0);
const masked=pair(meta('a')+std(100),meta('a')+'ExtLatency: TS=0,PC=100,TC=90');
assert.equal(masked.pairCount,1);assert.equal(masked.compared,0);assert.equal(masked.exact,0);assert.equal(masked.excluded,1);
for(const tail of ['PC=100','TC=100,TC=100','TC=100,PC=100']) {
  const r=pair(meta('a')+std(100),meta('a')+'ExtLatency: TS=0,'+tail);
  assert.equal(r.excluded,1);assert.equal(r.exact,0);
}
const badFinal=Array(16).fill(100);badFinal[11]=90;
assert.equal(pair(meta('a')+'Latency: '+badFinal.join(' '),meta('a')+'ExtLatency: TS=0,TC=100').excluded,1);
const missing=pair(std(100),'ExtLatency: TS=0,TC=100');
assert.equal(missing.pairCount,0);assert.equal(missing.missingIdentity,2);assert.equal(missing.unpaired,2);
const dup=api.parseLogRecords([meta('a')+std(100),meta('a')+std(100),meta('a')+'ExtLatency: TS=0,TC=100'].join('\n'));
const ambiguous=api.compareCrossFormat(dup.std,dup.ext);
assert.equal(ambiguous.exact,0);assert.equal(ambiguous.ambiguous,3);assert.equal(ambiguous.unpaired,3);
for(const [a,b] of [['domain(one)','domain(two)'],['[one][latency][info]','[two][extlatency][info]'],['host(a)','host(b)'],['2026-10-20T12:00:00Z a','2026-10-20T12:00:00Z b']]) {
  assert.equal(pair(meta('a',a)+std(100),meta('a',b)+'ExtLatency: TS=0,TC=100').pairCount,0,'scope prevents unrelated identity match');
}
assert.equal(pair(meta('a','[one][0x80e00073][latency][info]')+std(100),meta('a','[one][0x80e007ad][extlatency][info]')+'ExtLatency: TS=0,TC=100').exact,1);
assert.equal(pair(meta('a')+std(100),meta('a').replace('mpgw(test)','mpgw(other)')+'ExtLatency: TS=0,TC=100').pairCount,0);
const difference=pair(meta('a')+std(100),meta('a')+'ExtLatency: TS=0,TC=105');
assert.equal(difference.compared,1);assert.equal(difference.beyondOne,1);assert.equal(difference.maxDelta,5);
assert.equal(difference.pairs[0].enhancedTC,105);
assert.equal(api.parseLogRecords(std(1000)).std[0].ts,null);

// Independent permutation expectations: rotating enhanced log order must not
// alter endpoint comparisons for unique, complete IDs (100 deterministic sets).
for(let round=0;round<100;round++) {
  const size=7, s=[],e=[];let exact=0,one=0,other=0;
  for(let j=0;j<size;j++) {
    const total=100+round*10+j,delta=(round+j)%3;
    s.push(meta(j)+std(total));e.push(meta(j)+'ExtLatency: TS=0,TC='+(total+delta));
    if(!delta)exact++;else if(delta===1)one++;else other++;
  }
  const shift=round%size;e.push(...e.splice(0,shift));e.reverse();
  const logs=api.parseLogRecords([...s,...e].join('\n'));
  const r=api.compareCrossFormat(logs.std,logs.ext);
  assert.equal(r.exact,exact);assert.equal(r.withinOne,one);assert.equal(r.beyondOne,other);assert.equal(r.unpaired,0);
}

// F4: phase separator and TS are optional; unique, terminal, consistent TC is
// necessary for a completed enhanced observation.
for(const [payload,status] of [['HR=0,AXF=1,TC=2','complete'],['TS=0,IV=10,TC=10','complete'],['TS=0,AGS=500','partial'],['TS=0,TC=10,TC=10','conflicting'],['TS=0,TC=10,PC=10','conflicting'],['TS=0,PC=10,TC=9','conflicting']]) {
  const computed=api.computeExtTxn(api.parseExtLine('ExtLatency: '+payload).entries);
  assert.equal(computed.completionStatus,status);
  const rendered=result('ExtLatency: '+payload);
  if(status!=='complete')assert.match(rendered,/Completion unverified|Partial record/);
}
assert.match(result('ExtLatency: TS=0,AGS=500'),/Observed elapsed time/);
const wrapped='ExtLatency: HR=0,BS=3,\n == HR=4,TC=5';
assert.equal(api.computeExtTxn(api.parseExtLine(wrapped).entries).total,5);
const batch=api.parseLogRecords(wrapped);
assert.equal(batch.ext[0].completionStatus,'partial');assert.equal(batch.continuations.length,1);
elements.get('batch-raw').value=wrapped;elements.get('analyze-btn').click();
assert.match(elements.get('main-panel').innerHTML,/partial \(missing TC\): 1/);
assert.match(elements.get('main-panel').innerHTML,/summaries include all parsed records/);
console.log('Input integrity passed: strict payloads, line diagnostics, completion status, identity/scope matching, raw endpoints, and 100 permutation sets');
