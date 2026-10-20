const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadHtml}=require('./harness');
const standalone=path.join(__dirname,'..','dp-latency-trace.html');
const html=process.env.DP_HTML||(fs.existsSync(standalone)?standalone:path.join(__dirname,'..','dp-latency-trace','index.html'));
const {api,elements}=loadHtml(html);
const bars=t=>Array.from(t.html.matchAll(/data-start="(\d+)" data-end="(\d+)" data-peak="(\d+)" style="height:([\d.e+-]+)%;background:([^"]+)"/g),m=>({start:+m[1],end:+m[2],peak:+m[3],height:+m[4],color:m[5]}));
function checkTimeline(values){
  const txns=values.map((total,i)=>({total,n:i+1}));
  const output=api.buildTimeline(txns,t=>t.total===Math.max(0,...values.slice(0,20))?'red':'blue',t=>'#'+t.n);
  const displayed=bars(output);
  assert.ok(displayed.length<=1200);
  assert.equal(displayed[0]?.start,values.length?1:undefined);
  assert.equal(displayed.at(-1)?.end,values.length||undefined);
  let covered=0;
  const scale=values.reduce((m,v)=>Math.max(m,v),1);
  for(const b of displayed){
    assert.equal(b.start,covered+1,'groups contiguous with no omitted records');
    const group=values.slice(b.start-1,b.end);
    const peakValue=group.reduce((m,v)=>Math.max(m,v),-Infinity);
    assert.ok(b.peak>=b.start&&b.peak<=b.end);
    assert.equal(values[b.peak-1],peakValue,'each bar retains its group maximum');
    assert.equal(b.peak,b.start+group.indexOf(peakValue),'ties choose earliest record');
    assert.ok(Math.abs(b.height-peakValue/scale*100)<1e-8);
    covered=b.end;
  }
  assert.equal(covered,values.length);
  if(values.length<=1200)assert.equal(displayed.length,values.length);
  return {output,displayed};
}
for(const size of [0,1,1199,1200,1201,2401,28170]){
  const values=Array(size).fill(10);
  if(size>1)values[1]=9000; // The old every-nth scheme missed this peak.
  if(size>1200)values[size-1]=8000;
  const {output,displayed}=checkTimeline(values);
  if(size>1200){assert.match(output.note,/maximum per group/);assert.equal(displayed[0].peak,2);assert.equal(displayed[0].height,100);assert.equal(displayed.at(-1).peak,size);}
}
checkTimeline([0,0,0]);
// Large arrays must not use spread arguments to find the scale maximum.
checkTimeline(Array(150001).fill(1));
let seed=0x28170;
const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
for(let c=0;c<100;c++)checkTimeline(Array.from({length:1201+random(5000)},()=>random(20000)));
const peakColor=api.buildTimeline(Array.from({length:1201},(_,i)=>({total:i===1?100:1,n:i+1,color:i===1?'red':'blue'})),t=>t.color,t=>`#${t.n} <test>`);
assert.equal(bars(peakColor)[0].color,'red');assert.match(peakColor.html,/Record range 1-2; peak transaction: #2 &lt;test&gt;/);

// Unequal bin populations need unequal proportions; empty bins have zero height.
const hist=api.buildHistogram([1,10,100,1000]);
const histBars=Array.from(hist.matchAll(/height:([\d.]+)%" title="(\d+) transaction/g),m=>({height:+m[1],count:+m[2]}));
assert.equal(histBars.length,12);assert.equal(histBars.reduce((s,b)=>s+b.count,0),4);
assert.equal(histBars.find(b=>b.count===2).height,100);
assert.equal(histBars.find(b=>b.count===1).height,50);
histBars.filter(b=>b.count===0).forEach(b=>assert.equal(b.height,0));

// Keyword lists are taken from IBM's DataPower policy table and message catalog.
const policyKeys='CI COR CSEC EXT FC FNL GE GI GS HTM IV JTG JTV J2X LOG MAP OA OSW PAR RAL RED RES RL RLI RT SE SV SW TC TR TS US VAL WS WSDL XC XS XSL X2J'.split(' ');
const keywords=[...policyKeys,'CA','DNS','CR','CC'];
const txn=api.computeExtTxn(api.parseExtLine('ExtLatency: '+keywords.map((key,i)=>key+'='+i).join(',')).entries);
assert.equal(txn.rows.length,43);
txn.rows.forEach(r=>assert.equal(typeof r.label,'string',r.key+' needs a documented label'));
const descriptions=Object.fromEntries(Array.from(txn.rows,r=>[r.key,r.label]));
assert.equal(descriptions.IV,'Invoke policy');assert.equal(descriptions.GS,'GatewayScript policy');
assert.equal(descriptions.J2X,'JSON to XML policy');assert.equal(descriptions.X2J,'XML to JSON policy');
assert.equal(descriptions.XC,'Started execute policy');assert.equal(descriptions.XS,'Completed execute policy');
assert.equal(descriptions.CC,'Connection completes');
const unknown=api.computeExtTxn(api.parseExtLine('ExtLatency: TS=0,MYSTERY=2,rPC=3,constructor=4,TC=5').entries);
assert.equal(unknown.rows[1].label,null);assert.equal(unknown.rows[2].label,null);assert.equal(unknown.rows[3].label,null);

// 11 ms combined AGS contribution across THREE transactions, FOUR occurrences:
// contribution per transaction = 11/3; per occurrence would instead be 11/4.
elements.get('batch-raw').value=['ExtLatency: TS=0,AGS=2,AGS=7,TC=7','ExtLatency: TS=0,AGS=3,AGS=4,TC=4','ExtLatency: TS=0,PC=9,TC=9'].join('\n');
elements.get('analyze-btn').click();
const rendered=elements.get('main-panel').innerHTML;
assert.match(rendered,/Average contribution per transaction/);
assert.match(rendered,/absent keyword contributes zero/);
assert.doesNotMatch(rendered,/avg duration per action/);
assert.match(rendered,/Request: AGS[\s\S]*?contrib-val">3\.7 ms/);
console.log('Chart and keyword regression passed: 100 peak-bucket sets, 150001-record scale, histogram counts, 43 IBM keywords, and repeated-action averaging');
