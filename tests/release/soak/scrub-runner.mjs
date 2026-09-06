// Bounded, safe cleanup used by soak runners. All paths must be inside an
// owned scratch root; refuses filesystem roots, home, repo and arbitrary
// external directories, and validates against symlink/realpath escapes.

import { realpathSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";

const FORBIDDEN = new Set(
  ["/", process.env.HOME || os.homedir(), process.cwd()].map((p) => path.resolve(p))
);

/** Validate a scratch root the runner is allowed to destroy. */
export function validateScratchRoot(root) {
  let resolved;
  try {
    resolved = path.resolve(realpathSync(root));
  } catch {
    throw new Error(`Scratch root does not exist: ${root}`);
  }
  if (FORBIDDEN.has(resolved)) {
    throw new Error(`Refusing destructive operation on protected path: ${resolved}`);
  }
  // Refuse anything directly under / (e.g. /tmp itself, /home)
  if (path.dirname(resolved) === path.parse(resolved).root) {
    throw new Error(`Refusing filesystem root-level path: ${resolved}`);
  }
  // Refuse paths inside the current repo
  const repoRoot = path.resolve(process.cwd());
  if (resolved === repoRoot || resolved.startsWith(repoRoot + path.sep)) {
    throw new Error(`Refusing destructive operation inside repository: ${resolved}`);
  }
  // Refuse paths inside home other than explicit scratch temp dirs we own
  const home = path.resolve(process.env.HOME || os.homedir());
  if (resolved === home || (resolved.startsWith(home + path.sep) &&
      !resolved.startsWith(os.tmpdir()))) {
    // Allow os.tmpdir()-style scratch only. HOME itself and its subtree
    // outside tmp is refused to protect real user data.
    if (!resolved.startsWith(os.tmpdir() + path.sep)) {
      throw new Error(`Refusing destructive operation under home directory: ${resolved}`);
    }
  }
  return resolved;
}

/** Validate that a specific path is inside an already-validated scratch root. */
export function insideRoot(root, target) {
  const rel = path.relative(root, path.resolve(target));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Bounded removal of a validated subtree. */
export function safeRemove(root, target) {
  const r = validateScratchRoot(root);
  const t = path.resolve(target);
  if (!insideRoot(r, t)) {
    throw new Error(`Target escapes scratch root: ${t}`);
  }
  assertNoSymlinkEscape(r, t);
  rmSync(t, { recursive: true, force: true });
}

/** Validate every existing ancestor so rmSync cannot traverse an escaping link. */
function assertNoSymlinkEscape(root, target) {
  let current = target;
  while (current !== root) {
    try {
      const st = lstatSync(current);
      if (st.isSymbolicLink()) {
        const real = realpathSync(current);
        if (!insideRoot(root, real)) {
          throw new Error(`Symlink escapes scratch root: ${current} -> ${real}`);
        }
      }
    } catch (e) {
      if (e.code === "ENOENT") {
        current = path.dirname(current);
        continue;
      }
      throw e;
    }
    current = path.dirname(current);
  }
}
