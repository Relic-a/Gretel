import { createHash } from 'node:crypto';
import { lstatSync, statSync, readdirSync, readFileSync, realpathSync, readlinkSync, existsSync } from 'node:fs';
import path from 'node:path';

// No path-only cache: every invocation identifies the current bytes, including
// materialized symlink contents. Unreadable/escaping/cyclic entries invalidate identity.
export function getArtifactIdentity(artifactPath) {
  const resolved = path.resolve(artifactPath), entries = [], errors = [];
  if (!existsSync(resolved)) return {path:resolved, present:false, complete:false, errors:['Artifact missing']};
  const root = realpathSync(resolved);
  function walk(full, relative = '', ancestors = new Set()) {
    try {
      const actual = realpathSync(full);
      if (actual !== root && !actual.startsWith(root + path.sep)) throw Error('Symlink escapes artifact');
      const lst = lstatSync(full), st = statSync(full);
      if (lst.isSymbolicLink()) entries.push({path:relative, type:'symlink', size:0, sha256:hash(readlinkSync(full))});
      if (st.isDirectory()) {
        if (ancestors.has(actual)) throw Error('Cyclic artifact directory');
        const next = new Set([...ancestors, actual]);
        for (const name of readdirSync(full).sort()) walk(path.join(full,name), path.join(relative,name), next);
      } else if (st.isFile()) entries.push({path:relative, type:'file', size:st.size, sha256:hash(readFileSync(full))});
      else throw Error('Unsupported artifact entry');
    } catch(error) { errors.push({path:relative, error:String(error)}); }
  }
  walk(resolved);
  entries.sort((a,b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type));
  let version = 'unknown';
  try { version = JSON.parse(readFileSync(path.join(root,'package.json'))).version || version; } catch {}
  return {path:resolved, present:entries.length > 0 && errors.length === 0, complete:errors.length === 0, errors, manifestSha256:hash(JSON.stringify(entries)), filesCount:entries.filter(e=>e.type==='file').length, totalBytes:entries.reduce((s,e)=>s+e.size,0), serverSha256:entries.find(e=>e.path==='server.js')?.sha256 || null, version, runtime:{type:'system-node', nodeVersion:process.version, platform:process.platform, arch:process.arch}};
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }

export function getChaosSourceIdentity(repoRoot) {
  const roots = ['lib','app','gretel.config.json','package-lock.json','tests/release/chaos/chaos-worker.mjs'];
  const manifests = roots.filter(name => existsSync(path.join(repoRoot,name))).map(name => ({name,...getArtifactIdentity(path.join(repoRoot,name))}));
  return {scope:'source-module-workers', present:manifests.every(m=>m.present), manifestSha256:hash(JSON.stringify(manifests.map(m=>({name:m.name,hash:m.manifestSha256})))), roots:manifests};
}
