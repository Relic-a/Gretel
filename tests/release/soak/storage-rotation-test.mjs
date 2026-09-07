import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const scratch=mkdtempSync(path.join(tmpdir(),'gretel-rotation-controls-')),outcomes=[];
for(const mode of ['healthy','no-op','drop-writes','no-rename','wrong-retention']) {
 const resultFile=path.join(scratch,`${mode}.json`);
 const child=spawn(process.execPath,['tests/release/soak/storage-worker.mjs','--days','14','--profiles','3','--output',scratch,'--result-file',resultFile,'--logger-control',mode],{env:{PATH:process.env.PATH,HOME:scratch},stdio:['pipe','ignore','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b);
 const timeout=setTimeout(()=>child.kill('SIGKILL'),30000);
 const code=await new Promise(r=>child.on('close',r));clearTimeout(timeout);
 const report=JSON.parse(readFileSync(resultFile));const gate=report.cases.find(c=>c.id==='soak-storage-log-bounds');
 assert.equal(gate.status,mode==='healthy'?'pass':'fail',`${mode} ${stderr}`);
 outcomes.push({mode,exit:code,gate:gate.status});
}
writeFileSync(path.join(scratch,'outcomes.json'),JSON.stringify(outcomes,null,2));console.log(`Real loaded logger controls passed: ${scratch}`);
