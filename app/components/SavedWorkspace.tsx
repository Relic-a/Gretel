"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Check, Folder, FolderPlus, Loader2, MoreVertical, Search, StickyNote, Tag, Trash2, X } from "lucide-react";
import type { FeedVideo, SavedCollection, SavedItem } from "../types";
import { formatCardMeta, formatPublished, handleThumbnailError, normalize, thumbnailFor } from "./video-utils";
import { EmptyState } from "./EmptyState";
import { useDialogFocus } from "./use-dialog-focus";

export type SavedFilter = { folderId: string | null; tagId: string | null; query: string };
export type OrganizeDraft = { videoId: string; folderIds: string[]; tagIds: string[]; note?: string };
type Props = { onBrowse: () => void; items: SavedItem[]; folders: SavedCollection[]; tags: SavedCollection[]; savedVideoIds: Set<string>; loading: boolean; refreshing: boolean; error: string; filter: SavedFilter; onFilterChange: (next: SavedFilter) => void; onSelectVideo: (video: FeedVideo) => void; onToggleSave: (video: FeedVideo) => void; onUpdateItem: (id: string, update: { note?: string; folderIds?: string[]; tagIds?: string[] }) => Promise<void>; onCreateFolder: (name: string) => Promise<void>; onRenameFolder: (id: string, name: string) => Promise<void>; onDeleteFolder: (id: string) => Promise<void>; onCreateTag: (name: string) => Promise<void>; onRenameTag: (id: string, name: string) => Promise<void>; onDeleteTag: (id: string) => Promise<void>; onRetry: () => void };

export function SavedWorkspace(p: Props) {
  const [organizing, setOrganizing] = useState<OrganizeDraft | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState(p.filter.query); const timer = useRef<number | null>(null);
  useEffect(() => setDraft(p.filter.query), [p.filter.query]);
  const filtered = useMemo(() => p.items.filter((item) => (!p.filter.folderId || item.folders.some((f) => f.id === p.filter.folderId)) && (!p.filter.tagId || item.tags.some((t) => t.id === p.filter.tagId)) && (!p.filter.query || normalize([item.video.title, item.video.author, item.note, ...item.folders.map((x) => x.name), ...item.tags.map((x) => x.name)].join(" ")).includes(normalize(p.filter.query)))), [p.items, p.filter]);
  const active = p.folders.find((x) => x.id === p.filter.folderId);
  return <section className="saved-workspace" aria-label="Saved collections">
    <div className="saved-head"><div><h1>{active?.name || "Saved"}</h1><p>{p.items.length ? p.items.length + " saved " + (p.items.length === 1 ? "video" : "videos") : "Videos you save appear here."}</p></div><form className="saved-search" role="search" onSubmit={(e) => { e.preventDefault(); p.onFilterChange({ ...p.filter, query: draft }); }}><Search size={16} /><input type="search" value={draft} onChange={(e) => { const value = e.target.value; setDraft(value); if (timer.current) clearTimeout(timer.current); timer.current = window.setTimeout(() => p.onFilterChange({ ...p.filter, query: value }), 160); }} placeholder="Search saved videos" aria-label="Search saved videos" />{draft && <button type="button" aria-label="Clear saved search" onClick={() => { setDraft(""); p.onFilterChange({ ...p.filter, query: "" }); }}><X size={15} /></button>}</form></div>
    {p.error && <p className="error saved-error" role="alert">{p.error} <button onClick={p.onRetry}>Retry</button></p>}
    <div className="saved-layout"><SavedSidebar {...p} /><div className="saved-results">{p.loading && !p.items.length ? <div className="saved-grid" aria-hidden="true">{Array.from({ length: 6 }).map((_, i) => <article className="saved-card skeleton-card" key={i}><div className="skeleton skeleton-thumb" /></article>)}</div> : filtered.length ? <div className="saved-grid">{filtered.map((item) => <SavedCard key={item.video.id} item={item} onSelect={p.onSelectVideo} onUnsave={p.onToggleSave} onOrganize={() => setOrganizing({ videoId: item.video.id, folderIds: item.folders.map((x) => x.id), tagIds: item.tags.map((x) => x.id), note: item.note })} editingNote={noteId === item.video.id} onEditNote={() => setNoteId(item.video.id)} onCancelNote={() => setNoteId(null)} onSaveNote={async (note) => { await p.onUpdateItem(item.video.id, { note }); setNoteId(null); }} onFilter={(folderId) => p.onFilterChange({ ...p.filter, folderId, tagId: null })} />)}</div> : <EmptyState title={p.items.length ? "No matching saved videos" : "No saved videos yet"} actionLabel={p.items.length ? "Show all saved" : "Browse videos"} onAction={p.items.length ? () => p.onFilterChange({ folderId: null, tagId: null, query: "" }) : p.onBrowse}>{p.items.length ? "Try another collection or search." : "Save a video from Home or Watch. Organizing can wait."}</EmptyState>}{p.refreshing && <p className="saved-sync" role="status"><Loader2 size={15} className="spin" /> Syncing saved library…</p>}</div></div>
    {organizing && <OrganizeDialog draft={organizing} folders={p.folders} tags={p.tags} onClose={() => setOrganizing(null)} onCreateFolder={p.onCreateFolder} onCreateTag={p.onCreateTag} onSave={async (folderIds, tagIds, note) => { await p.onUpdateItem(organizing.videoId, { folderIds, tagIds, note }); setOrganizing(null); }} />}
  </section>;
}

function SavedSidebar(p: Props) {
  const [newName, setNewName] = useState(""); const [adding, setAdding] = useState(false);
  return <aside className="saved-sidebar" aria-label="Saved collections"><nav><button className={!p.filter.folderId && !p.filter.tagId ? "active" : ""} aria-current={!p.filter.folderId && !p.filter.tagId ? "true" : undefined} onClick={() => p.onFilterChange({ ...p.filter, folderId: null, tagId: null })}><Bookmark size={15} /> All saved <span>{p.items.length}</span></button>{p.folders.map((folder) => <CollectionRow key={folder.id} folder={folder} active={p.filter.folderId === folder.id} count={p.items.filter((item) => item.folders.some((x) => x.id === folder.id)).length} onSelect={() => p.onFilterChange({ ...p.filter, folderId: folder.id, tagId: null })} onRename={p.onRenameFolder} onDelete={p.onDeleteFolder} />)}</nav>{adding ? <form className="saved-inline-form" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void p.onCreateFolder(newName.trim()).then(() => { setNewName(""); setAdding(false); }); }}><input autoFocus value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="Collection name" aria-label="New collection name" /><button type="submit" aria-label="Create collection"><Check size={15} /></button><button type="button" aria-label="Cancel new collection" onClick={() => setAdding(false)}><X size={15} /></button></form> : <button className="new-collection" onClick={() => setAdding(true)}><FolderPlus size={15} /> New collection</button>}<details className="saved-advanced"><summary>Advanced filters</summary><div>{p.tags.length ? p.tags.map((tag) => <button key={tag.id} className={p.filter.tagId === tag.id ? "active" : ""} onClick={() => p.onFilterChange({ ...p.filter, tagId: tag.id, folderId: null })}><Tag size={13} /> {tag.name}</button>) : <p>No tags yet.</p>}</div></details></aside>;
}
function DeleteCollectionDialog({ name, onClose, onDelete }: { name: string; onClose: () => void; onDelete: () => Promise<void> }) {
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDialogFocus(ref, !busy, onClose);
  return <div className="modal-backdrop confirm-backdrop" onPointerDown={event => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-collection-title" aria-describedby="delete-collection-copy" tabIndex={-1}>
      <h2 id="delete-collection-title">Delete “{name}”?</h2>
      <p id="delete-collection-copy">Saved videos stay in Saved. Only this collection will be deleted.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="confirm-actions">
        <button type="button" className="confirm-keep" disabled={busy} onClick={onClose}>Keep collection</button>
        <button type="button" className="confirm-discard" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { await onDelete(); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete collection. Try again."); setBusy(false); }
        }}>{busy ? "Deleting…" : "Delete collection"}</button>
      </div>
    </section>
  </div>;
}

function CollectionRow({ folder, active, count, onSelect, onRename, onDelete }: { folder: SavedCollection; active: boolean; count: number; onSelect: () => void; onRename: (id: string, name: string) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [rename, setRename] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(folder.name);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDetailsElement>(null);
  return <div className="saved-nav-row">
    {rename ? <form className="saved-inline-form" onSubmit={async event => {
      event.preventDefault(); setError("");
      try { await onRename(folder.id, name); setRename(false); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not rename collection."); }
    }}>
      <input aria-label="Collection name" autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)} />
      <button aria-label="Save collection name" disabled={!name.trim()}><Check size={14} /></button>
      <button type="button" aria-label="Cancel rename" onClick={() => setRename(false)}><X size={14} /></button>
      {error && <p className="error" role="alert">{error}</p>}
    </form> : <>
      <button className={active ? "active" : ""} aria-current={active ? "true" : undefined} onClick={onSelect} title={folder.name}>
        <Folder size={15} aria-hidden="true" /><span className="collection-name">{folder.name}</span><span className="collection-count">{count}</span>
      </button>
      <details ref={menuRef} className="collection-more">
        <summary aria-label={"Manage " + folder.name}><MoreVertical size={15} /></summary>
        <div><button onClick={() => { setName(folder.name); setRename(true); }}>Rename</button>
          <button onClick={() => { if (menuRef.current) menuRef.current.open = false; setConfirmDelete(true); }}><Trash2 size={14} /> Delete</button></div>
      </details>
    </>}
    {confirmDelete && <DeleteCollectionDialog name={folder.name} onClose={() => setConfirmDelete(false)} onDelete={() => onDelete(folder.id)} />}
  </div>;
}
function SavedCard({ item, onSelect, onUnsave, onOrganize, editingNote, onEditNote, onCancelNote, onSaveNote, onFilter }: { item: SavedItem; onSelect: (v: FeedVideo) => void; onUnsave: (v: FeedVideo) => void; onOrganize: () => void; editingNote: boolean; onEditNote: () => void; onCancelNote: () => void; onSaveNote: (note: string) => Promise<void>; onFilter: (id: string) => void }) { const [note, setNote] = useState(item.note); return <article className="saved-card"><div className="thumbnail-wrap"><button className="thumbnail-button" onClick={() => onSelect(item.video)} aria-label={"Play " + item.video.title}><img src={thumbnailFor(item.video)} loading="lazy" alt="" onError={(e) => handleThumbnailError(e, item.video.id)} />{item.video.duration && <span className="duration-pill">{item.video.duration}</span>}</button></div><div className="video-meta saved-meta"><div className="saved-card-title"><h2>{item.video.title}</h2><details className="saved-card-more"><summary aria-label={"More actions for " + item.video.title}><MoreVertical size={17} /></summary><div><button onClick={onOrganize}>Organize</button><button onClick={onEditNote}>{item.note ? "Edit note" : "Add note"}</button><button onClick={() => onUnsave(item.video)}>Remove from saved</button></div></details></div><div className="video-byline"><span className="avatar" aria-hidden="true">{item.video.author.slice(0, 1).toUpperCase()}</span><span className="byline-copy"><span className="channel-name" title={item.video.author}>{item.video.author}</span><span className="published-line" title={formatCardMeta(item.video) || formatPublished(item.video)}>{formatCardMeta(item.video) || formatPublished(item.video)}</span></span></div>{item.folders.length > 0 && <button className="saved-collection-label" onClick={() => onFilter(item.folders[0].id)}><Folder size={12} /> {item.folders[0].name}{item.folders.length > 1 && " +" + (item.folders.length - 1)}</button>}{editingNote ? <form className="saved-note-editor" onSubmit={(e) => { e.preventDefault(); void onSaveNote(note); }}><textarea aria-label={"Note for " + item.video.title} autoFocus rows={3} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" /><button>Save note</button><button type="button" onClick={onCancelNote}>Cancel</button></form> : item.note && <button className="saved-note-view" onClick={onEditNote}><StickyNote size={14} /><span>{item.note}</span></button>}</div></article>; }

export function OrganizeDialog(p: { draft: OrganizeDraft; folders: SavedCollection[]; tags: SavedCollection[]; onClose: () => void; onCreateFolder: (name: string) => Promise<void>; onCreateTag: (name: string) => Promise<void>; onSave: (folderIds: string[], tagIds: string[], note: string) => void | Promise<void>; title?: string; submitLabel?: string }) { const ref = useRef<HTMLDivElement | null>(null); useDialogFocus(ref, true, p.onClose); const [ids, setIds] = useState(p.draft.folderIds); const [newName, setNewName] = useState(""); const [busy, setBusy] = useState(false); const toggle = (id: string) => setIds((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]); return <div className="modal-backdrop" onClick={p.onClose}><div ref={ref} role="dialog" aria-modal="true" aria-label="Organize saved video" tabIndex={-1} className="profile-modal saved-dialog" onClick={(e) => e.stopPropagation()}><div className="modal-head"><h1>{p.title || "Organize"}</h1><button className="icon-button" aria-label="Close organize dialog" onClick={p.onClose}><X size={17} /></button></div><div className="saved-dialog-body"><p>Choose collections for this video.</p><ul className="saved-checklist">{p.folders.map((folder) => <li key={folder.id}><label><input type="checkbox" checked={ids.includes(folder.id)} onChange={() => toggle(folder.id)} />{folder.name}</label></li>)}</ul><form className="saved-inline-form" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void p.onCreateFolder(newName.trim()).then(() => setNewName("")); }}><input value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="New collection" aria-label="New collection name" /><button disabled={!newName.trim()}>Add</button></form></div><div className="wizard-nav"><button className="secondary-button" onClick={p.onClose}>Cancel</button><button className="wizard-next" disabled={busy} onClick={() => { setBusy(true); void Promise.resolve(p.onSave(ids, p.draft.tagIds, p.draft.note || "")).finally(() => setBusy(false)); }}>{busy ? "Saving…" : p.submitLabel || "Done"}</button></div></div></div>; }
