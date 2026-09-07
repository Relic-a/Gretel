import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)), scratch=mkdtempSync(path.join(tmpdir(),'gretel-unified-controls-'));
const artifact=path.join(scratch,'custom-artifact');mkdirSync(artifact);writeFileSync(path.join(artifact,'server.js'),'// custom artifact');
const outcomes=[];
for(const mode of ['healthy','no-report','exit23','signal','timeout','malformed','stale','missing','duplicate','status','evidence','absent-evidence','artifact','reported-fail','skipped']) {
 const fixture=path.join(scratch,`${mode}.mjs`);copyFileSync(path.join(root,'fixtures/layer-control.mjs'),fixture);
 const output=path.join(scratch,mode);mkdirSync(output);
 writeFileSync(path.join(output,'report.json'),JSON.stringify({cases:[{id:'stale-pass',status:'pass'}]}));
 const res=spawnSync(process.execPath,[path.join(root,'run-all.mjs'),'--quick','--self-test','--strict','--artifact',artifact,'--fixture-layer',fixture,'--timeout',mode==='timeout'?'100':'5000','--output',output,...(mode==='skipped'?['--skip-chaos']:[])],{encoding:'utf8',timeout:20000});
 assert.equal(res.status,mode==='healthy'?0:1,`${mode}: ${res.stderr}\n${res.stdout}`);
 const invocation=readdirSync(output).find(n=>n.startsWith('invocation-'));
 const report=JSON.parse(readFileSync(path.join(output,invocation,'report.json')));
 assert.equal(report.scope,'self-test');
 if(mode==='healthy') for(const c of report.cases) for(const ev of c.evidence) assert(existsSync(path.join(output,invocation,ev)),ev);
 else assert(report.cases.some(c=>c.status==='fail'||c.status==='not_run'),mode);
 outcomes.push({mode,exit:res.status});
}
writeFileSync(path.join(scratch,'outcomes.json'),JSON.stringify(outcomes,null,2));
console.log(`Unified controls: ${outcomes.length} passed; evidence ${scratch}`);
