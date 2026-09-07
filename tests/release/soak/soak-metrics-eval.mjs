import assert from 'node:assert/strict';
import {verifyAcknowledgedRows} from './durable-evaluator.mjs';
import {spawnSync} from 'node:child_process';
import {evaluateIdleCpu, evaluateIdleRssStability, evaluateRssTrend, selectWindow, runIdlePhase} from './soak-evaluator.mjs';
let time=600000;const samples=[];
await runIdlePhase({durationMs:610000,intervalMs:10000,phaseId:'idle-a',now:()=>time,sleep:async ms=>{time+=ms+1;},sample:phase=>samples.push({...phase,elapsedMs:time,cpuTicks:time/1000,rssMb:200,processIdentity:'1:100'})});
const window=selectWindow(samples,600000,'start');
assert.equal(evaluateIdleCpu(window,{clockTicks:100}).status,'pass');
const later = window.map(s=>({...s,elapsedMs:s.elapsedMs+3600000,phaseId:"idle-b"}));
assert.equal(evaluateIdleRssStability(window,later).status,'pass');
assert.equal(evaluateIdleRssStability(window,window).status,'not_run');
const mixed=structuredClone(window);mixed[20].phase='active';mixed[20].op='browse';assert.notEqual(evaluateIdleCpu(mixed,{clockTicks:100}).status,'pass');
for(const mutation of [s=>s.cpuTicks=NaN,s=>s.truncated=true,s=>s.measurementError='read failed',s=>s.processIdentity='2:200']) {
 const broken=structuredClone(window);mutation(broken[20]);assert.notEqual(evaluateIdleCpu(broken,{clockTicks:100}).status,'pass');
}
const gap=window.filter((_,i)=>i<20||i>30);assert.equal(evaluateIdleCpu(gap,{clockTicks:100}).status,'blocked');
assert.equal(evaluateIdleCpu(window.slice(0,5),{clockTicks:100}).status,'not_run');
assert.equal(evaluateIdleCpu(window,{clockTicks:null}).status,'blocked');
assert.equal(evaluateIdleCpu(window.map(s=>({...s,cpuTicks:s.elapsedMs/10})),{clockTicks:100}).status,'fail');
assert.equal(evaluateIdleRssStability(window,later.map(s=>({...s,rssMb:400}))).status,'fail');
for(const field of ['rssMb','truncated']) {
 const broken=structuredClone(window);broken[20][field]=field==='rssMb'?0:true;
 assert.equal(evaluateIdleRssStability(broken,window).status,'blocked');
}
const trace=Array.from({length:900},(_,i)=>({elapsedMs:i*10001,rssMb:200}));
assert.equal(evaluateRssTrend(trace).status,'pass');
assert.equal(evaluateRssTrend(trace.map(s=>({...s,rssMb:200+s.elapsedMs/3600000*5}))).status,'fail');
const earlierLeak=trace.map(s=>({...s,rssMb:200+Math.min(s.elapsedMs,3600000)/3600000*20}));assert.equal(evaluateRssTrend(earlierLeak).status,'fail');
const lost=structuredClone(trace);lost[0].coverageLost=true;assert.equal(evaluateRssTrend(lost).status,'blocked');
const cli=new URL('./soak-cli.mjs',import.meta.url);
const result=spawnSync(process.execPath,[cli.pathname,'--phase-self-test'],{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);for(const key of ['cpu','rss','trend']) assert.equal(JSON.parse(result.stdout)[key].status,'pass',key);
console.log('Production resource evaluators and CLI virtual phase scheduler: all controls passed. No wall-clock qualification run performed.');

const ledger=[{profileId:'p',videoId:'v',row:{video_id:'v',watched_seconds:300,duration_seconds:600,watched_ratio:0.5,title:'Durable title',watched_at:123}}];
assert(verifyAcknowledgedRows(ledger,()=>({...ledger[0].row})).ok);
assert(!verifyAcknowledgedRows(ledger,()=>undefined).ok);
for(const field of Object.keys(ledger[0].row)) assert(!verifyAcknowledgedRows(ledger,()=>({...ledger[0].row,[field]:'corrupt'})).ok);
