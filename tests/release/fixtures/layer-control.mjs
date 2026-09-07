import {writeFileSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
if (process.argv.includes('--protocol')) process.exit(0);
const a = {};
for(let i=2;i<process.argv.length;i++) if (process.argv[i].startsWith('--') && !['--strict'].includes(process.argv[i])) a[process.argv[i].slice(2)] = process.argv[++i];
const mode = path.basename(process.argv[1]).replace('.mjs','');
const artifact = JSON.parse(a.identity);
if(a.layer !== 'chaos') {
  if(a.artifact !== artifact.path || !readFileSync(path.join(a.artifact,'server.js'),'utf8').includes('custom artifact')) throw Error('Custom artifact not propagated');
}
writeFileSync(path.join(a.output,'proof.txt'), 'Observed harmless layer execution; custom artifact path verified.');
const report = {schemaVersion:1, executionToken:process.env.GRETEL_VERIFICATION_TOKEN, layer:a.layer, gitSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), platform:process.platform, architecture:process.arch, mode:a.layer==='soak'?'storage':a.mode, artifact, cases:JSON.parse(a.inventory).map(id=>({id,status:'pass',evidence:['proof.txt']}))};
if(mode==='stale') report.executionToken='stale';
if(mode==='artifact') report.artifact.manifestSha256='wrong';
if(mode==='missing') report.cases.pop();
if(mode==='duplicate') report.cases.push(report.cases[0]);
if(mode==='status') report.cases[0].status='success';
if(mode==='evidence') report.cases[0].evidence=['absent'];
if(mode==='absent-evidence') report.cases[0].evidence=[];
if(mode==='reported-fail') report.cases[0].status='fail';
if(mode!=='no-report') writeFileSync(path.join(a.output,'report.json'),mode==='malformed'?'{':JSON.stringify(report));
if(mode==='timeout') await new Promise(()=>setInterval(()=>{},1000));
if(mode==='signal') process.kill(process.pid,'SIGTERM');
process.exit(['exit23','no-report'].includes(mode)?23:mode==='reported-fail'?1:0);
