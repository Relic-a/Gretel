#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import { writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const a = Object.fromEntries(process.argv.slice(2).reduce((r, v, i, all) => i % 2 ? r : [...r, [v.slice(2), all[i + 1]]], []));
const mode = path.basename(process.argv[1]).replace('.mjs', '');
if (process.env.GRETEL_TEST_PARENT_SECRET) throw Error('Parent environment leaked');
const report = { schemaVersion: 1, runId: a['run-id'], targetOs: a['target-os'], architecture: a.architecture, packageFormat: a['package-format'], qualification: a.qualification, oldArtifactHash: a['old-hash'], newArtifactHash: a['new-hash'], cases: a['case-ids'].split(',').map(id => ({id, status: 'pass', evidence: ['proof.txt']})) };
writeFileSync(path.join(a['evidence-dir'], 'proof.txt'), 'Harmless protocol evidence; no installation occurred.');
if (mode === 'stale') report.runId = 'stale';
if (mode === 'hash') report.newArtifactHash = 'wrong';
if (mode === 'package') report.packageFormat = 'rpm';
if (mode === 'architecture') report.architecture = 'wrong';
if (mode === 'platform') report.targetOs = 'wrong';
if (mode === 'duplicate') report.cases.push(report.cases[0]);
if (mode === 'missing') report.cases.pop();
if (mode === 'unexpected') report.cases[0].id = 'unexpected';
if (mode === 'status') report.cases[0].status = 'success';
if (mode === 'reported-fail') report.cases[0].status = 'fail';
if (mode === 'absent-evidence') report.cases[0].evidence = [];
if (mode === 'empty-file') writeFileSync(path.join(a['evidence-dir'], 'proof.txt'), '');
if (mode === 'directory') {mkdirSync(path.join(a['evidence-dir'],'directory'));report.cases[0].evidence=['directory'];}
if (mode === 'missing-file') report.cases[0].evidence = ['missing.txt'];
if (mode === 'traversal') { writeFileSync(path.join(a['scratch-dir'], 'sentinel'), 'owned sentinel'); report.cases[0].evidence = ['../runner-scratch/sentinel']; }
if (mode === 'symlink') { symlinkSync(path.join(a['evidence-dir'], 'proof.txt'), path.join(a['evidence-dir'], 'link')); report.cases[0].evidence = ['link']; }
if (mode !== 'no-report') writeFileSync(a['report-file'], mode === 'malformed' ? '{' : JSON.stringify(report));
if (mode === 'active-request') {
  const server=createServer(() => {writeFileSync(path.join(a['scratch-dir'],'active.json'),JSON.stringify({port:server.address().port,pid:process.pid}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  void fetch(`http://127.0.0.1:${server.address().port}`,{signal:AbortSignal.timeout(4000)}).catch(()=>{});
  await new Promise(()=>setInterval(()=>{},1000));
}
if (mode === 'report-partial') {writeFileSync(a['report-file'],'{"schemaVersion":');await new Promise(()=>setInterval(()=>{},1000));}
if (mode === 'timeout') await new Promise(() => setInterval(() => {}, 1000));
if (mode === 'orphan') {spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}).unref();}
if (mode === 'signal') process.kill(process.pid, 'SIGTERM');
process.exit(mode === 'exit23' || mode === 'no-report' ? 23 : 0);
