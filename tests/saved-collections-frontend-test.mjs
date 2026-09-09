import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../app/components/SavedWorkspace.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../app/components/use-saved-collections.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
const types = readFileSync(new URL("../app/types.ts", import.meta.url), "utf8");

// Workspace renders the full navigation + organization surface.
assert.match(workspace, /role="search"/, "saved workspace must expose a search landmark");
assert.match(workspace, /aria-label="Folders and tags"/, "sidebar must be a labelled navigation region");
assert.match(workspace, /role="dialog"/, "organize flow must use an accessible dialog");
assert.match(workspace, /aria-modal="true"/, "organize dialog must be modal");
assert.match(workspace, /textarea/, "notes must be editable inline");
assert.match(workspace, /maxLength=\{5000\}/, "note editor must honor the backend 5000-char limit");
assert.match(workspace, /onUpdateItem/, "workspace must call update-item");
assert.ok(workspace.includes("onCreateFolder") && workspace.includes("onDeleteTag"), "workspace must wire folder/tag CRUD");
assert.match(workspace, /window\.confirm\(/, "destructive folder/tag deletes must confirm first");
assert.match(workspace, /aria-pressed/, "membership toggles must expose pressed state");
assert.match(workspace, /role="status"/, "background sync must announce via a live region");
assert.match(workspace, /role="alert"/, "errors must use an alert role");

// Hook talks to the exact backend contract and recovers optimistically.
for (const action of ["save", "unsave", "update-item", "create-folder", "rename-folder", "delete-folder", "create-tag", "rename-tag", "delete-tag"]) {
  assert.ok(hook.includes(`"${action}"`) || page.includes(`"${action}"`), `frontend must exercise backend action ${action}`);
}
assert.match(hook, /\/api\/saved-collections\?/, "hook must list via GET /api/saved-collections");
assert.match(hook, /profileId/, "hook must scope every request to profileId");
assert.match(hook, /snapshot/, "mutations must snapshot state for rollback on failure");
assert.match(hook, /pendingSaves/, "save toggles must track pending state");

// Page integration preserves familiar save behavior on Home/Watch.
assert.match(page, /SavedWorkspace/, "saved section must render the Saved workspace");
assert.match(page, /toggleSave/, "home/watch save toggles must flow through saved collections");
assert.match(page, /syncSavedCollectionsSnapshot/, "collection mutations must keep legacy saved lists in sync");
assert.doesNotMatch(page, /\/api\/saved-videos\?profileId/, "saved loading must use the collections endpoint");
assert.doesNotMatch(page, /section === "saved"\s*\?\s*"Saved"/, "saved section must not reuse the flat feed heading");

// Product-specific styling hooks exist and stay responsive/accessible.
for (const token of [".saved-workspace", ".saved-layout", ".saved-sidebar", ".saved-grid", ".saved-card", ".saved-note-view", ".saved-dialog", ".saved-empty", ".saved-chip", ".saved-search"]) {
  assert.ok(styles.includes(token), `styles must define ${token}`);
}
assert.match(styles, /@media \(max-width: 1024px\)[\s\S]*?\.saved-layout/, "saved layout must collapse on tablet");
assert.match(styles, /prefers-reduced-motion/, "reduced-motion support must be preserved");

// Shared types carry the backend contract.
assert.match(types, /SavedItem/, "shared types must describe saved items");
assert.match(types, /SavedCollection/, "shared types must describe folders/tags");
assert.match(types, /note: string/, "saved items must carry notes");
assert.match(types, /folders: SavedCollection/, "saved items must carry folder membership");

console.log("saved collections frontend tests passed");
