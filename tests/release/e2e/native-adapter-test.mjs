#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(path.join(tmpdir(), 'gretel-native-controls-'));
for (const name of ['old.deb', 'new.deb']) writeFileSync(path.join(scratch, name), name);
const outcomes = [];
for (const mode of ['healthy','exit23','no-report','signal','timeout','malformed','stale','hash','package','architecture','platform','duplicate','missing','unexpected','status','reported-fail','absent-evidence','missing-file','traversal','symlink','empty-file','directory','format-config']) {
  const runner = path.join(scratch, `${mode}.mjs`);
  copyFileSync(path.join(root, 'fixtures/native-protocol-control.mjs'), runner); chmodSync(runner, 0o700);
  const output = path.join(scratch, mode);
  const result = spawnSync(process.execPath, [path.join(root, 'native-adapter.mjs'), '--protocol-test', '--strict', '--old-artifact', path.join(scratch, 'old.deb'), '--new-artifact', path.join(scratch, 'new.deb'), '--runner', runner, ...(mode==='format-config'?['--package-format','rpm']:[]), '--timeout', mode === 'timeout' ? '150' : '2000', '--output', output], {encoding:'utf8', timeout:5000, env:{...process.env, GRETEL_TEST_PARENT_SECRET:'synthetic-only'}});
  assert.equal(result.status, mode === 'healthy' ? 0 : 1, `${mode}: ${result.stderr}`);
  const report = JSON.parse(readFileSync(path.join(output, 'report.json')));
  assert.equal(report.mode, 'protocol-test');
  if (mode === 'healthy') for (const c of report.cases.filter(c => c.evidence.length)) for (const ev of c.evidence) assert(existsSync(path.join(output, ev)));
  else assert(report.cases.some(c => c.status === 'fail'), mode);
  outcomes.push({mode, exit:result.status});
}
writeFileSync(path.join(scratch, 'outcomes.json'), JSON.stringify(outcomes,null,2));
console.log(`Native controls: ${outcomes.length} passed; evidence ${scratch}`);

// Cancellation after a runner has already written passing JSON must remain failure.
{
 const {spawn}=await import('node:child_process');
 const {readdirSync}=await import('node:fs');
 const output=path.join(scratch,'cancel-after-report');
 const child=spawn(process.execPath,[path.join(root,'native-adapter.mjs'),'--protocol-test','--strict','--old-artifact',path.join(scratch,'old.deb'),'--new-artifact',path.join(scratch,'new.deb'),'--runner',path.join(scratch,'timeout.mjs'),'--timeout','5000','--output',output],{stdio:'ignore'});
 const completed=new Promise(r=>child.on('close',r));let ready=false;
 for(let i=0;i<100;i++){try{ready=readdirSync(output).filter(n=>n.startsWith('native-run-')).some(n=>existsSync(path.join(output,n,'runner-report.json')));}catch{}if(ready)break;await new Promise(r=>setTimeout(r,20));}
 child.kill('SIGTERM');const code=await completed;assert(ready);assert.equal(code,1);
 const report=JSON.parse(readFileSync(path.join(output,'report.json')));assert(report.cases.some(c=>c.status==='fail'));
 console.log('Native cancellation after passing JSON correctly fails.');
}
