import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runOwned} from './owned-process.mjs';
const scratch=mkdtempSync(path.join(tmpdir(),'gretel-lifecycle-controls-'));
const fixture=path.join(scratch,'descendant.mjs');
writeFileSync(fixture,`import {spawn} from 'node:child_process';const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
const owned=await runOwned(process.execPath,[fixture],{env:{PATH:process.env.PATH,HOME:scratch},timeout:400});
assert(owned.timedOut);assert(owned.owned.length>=2);assert.equal(owned.survivors.length,0);
writeFileSync(path.join(scratch,'descendant-result.json'),JSON.stringify(owned,null,2));
for(const phase of ['startup','idle']) {
 const output=path.join(scratch,phase);
 const child=spawn(process.execPath,['tests/release/soak/run-soak-verification.mjs','--skip-storage','--duration','60','--interval','1','--output',output],{env:{PATH:process.env.PATH,HOME:scratch},stdio:'ignore'});
 const completion=new Promise(r=>child.on('close',(code,signal)=>r({code,signal})));
 let server,phaseSeen=false;
 const deadline=Date.now()+25000;
 while(Date.now()<deadline) {
  try {
   const sub=readdirSync(output).find(n=>n.startsWith('soak-soak-verify-'));
   const logs=path.join(output,sub,'logs');
   const events=readFileSync(path.join(logs,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
   server=events.find(e=>e.type==='owned-server');
   phaseSeen=phase==='startup'?!!server:readFileSync(path.join(logs,'metrics.jsonl'),'utf8').includes('"phase":"idle"');
  } catch {}
  if(phaseSeen)break;
  await new Promise(r=>setTimeout(r,50));
 }
 child.kill('SIGTERM');
 const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);
 const result=await completion;clearTimeout(timeout);
 assert(phaseSeen,`${phase} boundary not reached`);
 assert.notEqual(result.code,0);
 const report=JSON.parse(readFileSync(path.join(output,'report.json')));
 assert(report.cases.some(c=>c.id==='soak-cancelled'&&c.status==='fail'));
 let listening=false;try {await fetch(`http://127.0.0.1:${server.port}`,{signal:AbortSignal.timeout(500)});listening=true;}catch{}
 assert.equal(listening,false,`${phase}: owned server port remained open`);
}
console.log(`Cancellation controls passed, including detached descendant and real startup/idle server teardown: ${scratch}`);

for (const phase of ['storage-compilation','storage-workload']) {
 const output=path.join(scratch,phase);
 const child=spawn(process.execPath,['tests/release/soak/run-soak-verification.mjs','--storage-only','--storage-days','180','--output',output],{env:{PATH:process.env.PATH,HOME:scratch},stdio:'ignore'});
 const completion=new Promise(r=>child.on('close',(code,signal)=>r({code,signal})));
 let compilerSeen=false, reached=false;const seen=new Map();const deadline=Date.now()+15000;
 while(Date.now()<deadline) {
  const queue=[child.pid];let compiling=false,working=false;
  while(queue.length){const pid=queue.shift();try{
    const stat=readFileSync(`/proc/${pid}/stat`,'utf8');const fields=stat.slice(stat.lastIndexOf(') ')+2).split(' ');
    const cmd=readFileSync(`/proc/${pid}/cmdline`,'utf8');seen.set(pid,fields[19]);
    if(cmd.includes('typescript')||cmd.includes('/tsc'))compiling=true;
    if(cmd.includes('storage-worker.mjs'))working=true;
    queue.push(...readFileSync(`/proc/${pid}/task/${pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean).map(Number));
   }catch{}}
  compilerSeen ||= compiling;
  reached=phase==='storage-compilation'?compiling:compilerSeen&&!compiling&&working;
  if(reached)break;
  await new Promise(r=>setTimeout(r,10));
 }
 child.kill('SIGTERM');const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);const result=await completion;clearTimeout(timeout);
 assert(reached,`${phase} boundary not observed`);assert.notEqual(result.code,0);
 const report=JSON.parse(readFileSync(path.join(output,'report.json')));assert(report.cases.some(c=>c.id==='soak-cancelled'));
 for(const [pid,start] of seen){try{const stat=readFileSync(`/proc/${pid}/stat`,'utf8');const fields=stat.slice(stat.lastIndexOf(') ')+2).split(' ');assert(fields[19]!==start||['Z','X'].includes(fields[0]),`${phase}: owned process ${pid} survived`);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
console.log('Real storage compilation and workload cancellation controls passed.');
