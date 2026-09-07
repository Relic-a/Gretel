import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';

function identity(pid) {
 try {const fields=readFileSync(`/proc/${pid}/stat`,'utf8').slice(readFileSync(`/proc/${pid}/stat`,'utf8').lastIndexOf(') ')+2).split(' ');return {pid,start:fields[19],state:fields[0]};} catch {return null;}
}
function alive(record) {const current=identity(record.pid);return current && current.start===record.start && !['Z','X'].includes(current.state);}

// Own only the spawned process and observed descendants, identified by PID plus
// kernel start time. Never signal by executable name or an unrelated process group.
export async function runOwned(command,args,{cwd,env,timeout=600000,graceMs=1000,signal,stdin='ignore',onSpawn}={}) {
 const child=spawn(command,args,{cwd,env,detached:process.platform!=='win32',stdio:[stdin,'pipe','pipe']});
 const records=new Map();let stdout='',stderr='',timedOut=false,cancelled=false,error=null;
 const discover=()=>{
  const queue=[child.pid],seen=new Set();
  while(queue.length && seen.size<512){const pid=queue.shift();if(!pid||seen.has(pid))continue;seen.add(pid);const record=identity(pid);if(!record)continue;records.set(`${pid}:${record.start}`,record);try {queue.push(...readFileSync(`/proc/${pid}/task/${pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean).map(Number));}catch{}}
 };
 const send=sig=>{discover();for(const record of [...records.values()].reverse())if(alive(record))try{process.kill(record.pid,sig);}catch{};if(process.platform!=='linux')try{child.kill(sig);}catch{}};
 let escalation;
 const stop=()=>{send('SIGTERM');if(!escalation)escalation=setTimeout(()=>send('SIGKILL'),graceMs);};
 const abort=()=>{cancelled=true;stop();};
 process.once('SIGINT',abort);process.once('SIGTERM',abort);signal?.addEventListener('abort',abort,{once:true});
 discover();onSpawn?.(child);
 if(signal?.aborted)abort();
 const scan=setInterval(discover,50);const timer=setTimeout(()=>{timedOut=true;stop();},timeout);
 child.stdout.on('data',b=>{stdout=(stdout+b).slice(-2_000_000);});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-2_000_000);});
 const result=await new Promise(resolve=>{child.on('error',e=>{error=String(e);});child.on('close',(status,signal)=>resolve({status,signal}));});
 clearTimeout(timer);clearInterval(scan);
 const leaked=[...records.values()].filter(alive);
 if(leaked.length) {send('SIGTERM');await new Promise(r=>setTimeout(r,graceMs));send('SIGKILL');await new Promise(r=>setTimeout(r,50));}
 clearTimeout(escalation);process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);signal?.removeEventListener('abort',abort);
 return {...result,stdout,stderr,error,timedOut,cancelled,owned:[...records.values()],survivors:[...records.values()].filter(alive), leaked:leaked.map(r=>r.pid)};
}
