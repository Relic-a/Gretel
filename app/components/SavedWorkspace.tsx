"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  Folder,
  FolderPlus,
  Loader2,
  Pencil,
  Search,
  StickyNote,
  Tag,
  Trash2,
  X
} from "lucide-react";

import type { FeedVideo, SavedCollection, SavedItem } from "../types";
import { formatPublished, handleThumbnailError, normalize, thumbnailFor } from "./video-utils";
import { useDialogFocus } from "./use-dialog-focus";

export type SavedFilter = {
  folderId: string | null;
  tagId: string | null;
  query: string;
};

type SavedWorkspaceProps = {
  items: SavedItem[];
  folders: SavedCollection[];
  tags: SavedCollection[];
  savedVideoIds: Set<string>;
  loading: boolean;
  refreshing: boolean;
  error: string;
  filter: SavedFilter;
  onFilterChange: (next: SavedFilter) => void;
  onSelectVideo: (video: FeedVideo) => void;
  onToggleSave: (video: FeedVideo) => void;
  onUpdateItem: (videoId: string, update: { note?: string; folderIds?: string[]; tagIds?: string[] }) => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onCreateTag: (name: string) => Promise<void>;
  onRenameTag: (tagId: string, name: string) => Promise<void>;
  onDeleteTag: (tagId: string) => Promise<void>;
  onRetry: () => void;
};

export type OrganizeDraft = {
  videoId: string;
  folderIds: string[];
  tagIds: string[];
  note?: string;
};

export function SavedWorkspace(props: SavedWorkspaceProps) {
  const [organizing, setOrganizing] = useState<OrganizeDraft | null>(null);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [inlineError, setInlineError] = useState("");
  const searchTimer = useRef<number | null>(null);
  const [searchDraft, setSearchDraft] = useState(props.filter.query);

  useEffect(() => {
    setSearchDraft(props.filter.query);
  }, [props.filter.query]);

  const counts = useMemo(() => {
    const byFolder = new Map<string, number>();
    const byTag = new Map<string, number>();
    for (const item of props.items) {
      for (const folder of item.folders) {
        byFolder.set(folder.id, (byFolder.get(folder.id) || 0) + 1);
      }
      for (const tag of item.tags) {
        byTag.set(tag.id, (byTag.get(tag.id) || 0) + 1);
      }
    }
    return { byFolder, byTag };
  }, [props.items]);

  const filtered = useMemo(() => {
    const query = normalize(props.filter.query);
    return props.items.filter((item) => {
      if (props.filter.folderId && !item.folders.some((folder) => folder.id === props.filter.folderId)) {
        return false;
      }
      if (props.filter.tagId && !item.tags.some((tag) => tag.id === props.filter.tagId)) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = normalize([
        item.video.id,
        item.video.title,
        item.video.author,
        item.video.query || "",
        item.note,
        ...item.folders.map((folder) => folder.name),
        ...item.tags.map((tag) => tag.name)
      ].join(" "));
      return haystack.includes(query);
    });
  }, [props.items, props.filter]);

  function handleSearchChange(value: string) {
    setSearchDraft(value);
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
    }
    searchTimer.current = window.setTimeout(() => {
      props.onFilterChange({ ...props.filter, query: value });
    }, 160);
  }

  async function runMutation(videoId: string, work: () => Promise<void>) {
    setPendingIds((current) => new Set(current).add(videoId));
    setInlineError("");
    try {
      await work();
    } catch (caught) {
      setInlineError(caught instanceof Error ? caught.message : "Could not update this saved video.");
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(videoId);
        return next;
      });
    }
  }

  const activeFolder = props.folders.find((folder) => folder.id === props.filter.folderId);
  const activeTag = props.tags.find((tag) => tag.id === props.filter.tagId);
  const heading = activeFolder ? activeFolder.name : activeTag ? `# ${activeTag.name}` : "Saved library";
  const subheading = props.items.length === 0
    ? "Save videos from Home or Watch to build research shelves."
    : `${props.items.length} saved ${props.items.length === 1 ? "video" : "videos"} · ${props.folders.length} folders · ${props.tags.length} tags`;

  return (
    <section className="saved-workspace" aria-label="Saved collections">
      <div className="saved-head">
        <div>
          <p className="saved-kicker">Collections</p>
          <h1>{heading} <span aria-hidden="true">✦</span></h1>
          <p>{subheading}</p>
        </div>
        <form
          className="saved-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            props.onFilterChange({ ...props.filter, query: searchDraft });
          }}
        >
          <Search aria-hidden="true" size={16} />
          <input
            type="search"
            value={searchDraft}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search titles, notes, folders, tags"
            aria-label="Search saved videos"
          />
          {searchDraft && (
            <button
              type="button"
              className="saved-search-clear"
              aria-label="Clear saved search"
              onClick={() => {
                setSearchDraft("");
                props.onFilterChange({ ...props.filter, query: "" });
              }}
            >
              <X aria-hidden="true" size={15} />
            </button>
          )}
        </form>
      </div>

      {(props.error || inlineError) && (
        <p className="error saved-error" role="alert">
          {inlineError || props.error}{" "}
          <button type="button" className="saved-error-retry" onClick={props.onRetry}>
            Retry
          </button>
        </p>
      )}

      <div className="saved-layout">
        <SavedSidebar
          folders={props.folders}
          tags={props.tags}
          counts={counts}
          totalCount={props.items.length}
          filter={props.filter}
          onFilterChange={props.onFilterChange}
          onCreateFolder={props.onCreateFolder}
          onRenameFolder={props.onRenameFolder}
          onDeleteFolder={props.onDeleteFolder}
          onCreateTag={props.onCreateTag}
          onRenameTag={props.onRenameTag}
          onDeleteTag={props.onDeleteTag}
        />

        <div className="saved-results">
          {props.loading && filtered.length === 0 ? (
            <div className="saved-grid" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <article key={`saved-skeleton-${index}`} className="saved-card skeleton-card">
                  <div className="skeleton skeleton-thumb" />
                  <div className="video-meta">
                    <div className="skeleton skeleton-line wide" />
                    <div className="skeleton skeleton-line medium" />
                  </div>
                </article>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <SavedEmptyState
              hasItems={props.items.length > 0}
              query={props.filter.query}
              folderName={activeFolder?.name}
              tagName={activeTag?.name}
              onClear={() => props.onFilterChange({ folderId: null, tagId: null, query: "" })}
            />
          ) : (
            <div className="saved-grid">
              {filtered.map((item) => (
                <SavedCard
                  key={item.video.id}
                  item={item}
                  saved={props.savedVideoIds.has(item.video.id)}
                  pending={pendingIds.has(item.video.id)}
                  noteEditing={noteEditingId === item.video.id}
                  onSelectVideo={props.onSelectVideo}
                  onToggleSave={props.onToggleSave}
                  onStartNote={() => setNoteEditingId(item.video.id)}
                  onCancelNote={() => setNoteEditingId(null)}
                  onSaveNote={(note) =>
                    runMutation(item.video.id, async () => {
                      await props.onUpdateItem(item.video.id, { note });
                      setNoteEditingId(null);
                    })
                  }
                  onOrganize={() =>
                    setOrganizing({
                      videoId: item.video.id,
                      folderIds: item.folders.map((folder) => folder.id),
                      tagIds: item.tags.map((tag) => tag.id),
                      note: item.note
                    })
                  }
                  onPickFolder={(folderId) =>
                    runMutation(item.video.id, () =>
                      props.onUpdateItem(item.video.id, {
                        folderIds: toggleId(item.folders.map((folder) => folder.id), folderId)
                      })
                    )
                  }
                  onPickTag={(tagId) =>
                    runMutation(item.video.id, () =>
                      props.onUpdateItem(item.video.id, {
                        tagIds: toggleId(item.tags.map((tag) => tag.id), tagId)
                      })
                    )
                  }
                  onClearFilter={(next) => props.onFilterChange(next)}
                  activeFolderId={props.filter.folderId}
                  activeTagId={props.filter.tagId}
                />
              ))}
            </div>
          )}
          {(props.loading || props.refreshing) && filtered.length > 0 && (
            <p className="saved-sync" role="status">
              <Loader2 aria-hidden="true" size={15} className="spin" /> Syncing saved library…
            </p>
          )}
        </div>
      </div>

      {organizing && (
        <OrganizeDialog
          draft={organizing}
          folders={props.folders}
          tags={props.tags}
          onClose={() => setOrganizing(null)}
          onCreateFolder={props.onCreateFolder}
          onCreateTag={props.onCreateTag}
          onSave={(folderIds, tagIds, note) =>
            runMutation(organizing.videoId, async () => {
              await props.onUpdateItem(organizing.videoId, { folderIds, tagIds, note });
              setOrganizing(null);
            })
          }
        />
      )}
    </section>
  );
}

function toggleId(current: string[], id: string) {
  return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
}

function SavedEmptyState(props: {
  hasItems: boolean;
  query: string;
  folderName?: string;
  tagName?: string;
  onClear: () => void;
}) {
  const title = !props.hasItems
    ? "No saved videos yet"
    : props.query
      ? `No matches for “${props.query}”`
      : props.folderName
        ? `“${props.folderName}” is empty`
        : props.tagName
          ? `Nothing tagged “${props.tagName}” yet`
          : "Nothing here yet";
  const copy = !props.hasItems
    ? "Tap Save on any Home or Watch video. Everything lands in Watch Later until you file it."
    : "Try a shorter search, another folder, or a different tag.";

  return (
    <div className="saved-empty">
      <span className="saved-empty-mark" aria-hidden="true">
        <Bookmark size={22} />
      </span>
      <h2>{title}</h2>
      <p>{copy}</p>
      {props.hasItems && (
        <button type="button" className="secondary-button" onClick={props.onClear}>
          Show everything
        </button>
      )}
    </div>
  );
}

function SavedSidebar(props: {
  folders: SavedCollection[];
  tags: SavedCollection[];
  counts: { byFolder: Map<string, number>; byTag: Map<string, number> };
  totalCount: number;
  filter: SavedFilter;
  onFilterChange: (next: SavedFilter) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onCreateTag: (name: string) => Promise<void>;
  onRenameTag: (tagId: string, name: string) => Promise<void>;
  onDeleteTag: (tagId: string) => Promise<void>;
}) {
  const [folderDraft, setFolderDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  async function guarded(work: () => Promise<void>) {
    setBusy(true);
    setFormError("");
    try {
      await work();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Could not update collections.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="saved-sidebar" aria-label="Folders and tags">
      <div className="saved-sidebar-block">
        <div className="saved-sidebar-title">
          <h2>Folders</h2>
          <span className="saved-count">{props.folders.length}</span>
        </div>
        <ul className="saved-nav">
          <li>
            <button
              type="button"
              className={!props.filter.folderId && !props.filter.tagId ? "active" : ""}
              aria-current={!props.filter.folderId && !props.filter.tagId ? "true" : undefined}
              onClick={() => props.onFilterChange({ ...props.filter, folderId: null, tagId: null })}
            >
              <Folder aria-hidden="true" size={15} /> Everything
              <span className="saved-count">{props.totalCount}</span>
            </button>
          </li>
          {props.folders.map((folder) => (
            <li key={folder.id}>
              {editingFolderId === folder.id ? (
                <form
                  className="saved-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void guarded(async () => {
                      await props.onRenameFolder(folder.id, renameDraft);
                      setEditingFolderId(null);
                    });
                  }}
                >
                  <input
                    autoFocus
                    value={renameDraft}
                    maxLength={80}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    aria-label={`Rename ${folder.name}`}
                  />
                  <button type="submit" aria-label="Save folder name" disabled={busy}>
                    <Check aria-hidden="true" size={15} />
                  </button>
                  <button type="button" aria-label="Cancel rename" onClick={() => setEditingFolderId(null)}>
                    <X aria-hidden="true" size={15} />
                  </button>
                </form>
              ) : (
                <div className="saved-nav-row">
                  <button
                    type="button"
                    className={props.filter.folderId === folder.id ? "active" : ""}
                    aria-current={props.filter.folderId === folder.id ? "true" : undefined}
                    onClick={() =>
                      props.onFilterChange({
                        ...props.filter,
                        folderId: props.filter.folderId === folder.id ? null : folder.id,
                        tagId: null
                      })
                    }
                  >
                    <Folder aria-hidden="true" size={15} /> {folder.name}
                    <span className="saved-count">{props.counts.byFolder.get(folder.id) || 0}</span>
                  </button>
                  <span className="saved-row-actions">
                    <button
                      type="button"
                      aria-label={`Rename ${folder.name}`}
                      title={`Rename ${folder.name}`}
                      onClick={() => {
                        setEditingFolderId(folder.id);
                        setRenameDraft(folder.name);
                      }}
                    >
                      <Pencil aria-hidden="true" size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${folder.name}`}
                      title={`Delete ${folder.name}`}
                      onClick={() => {
                        if (window.confirm(`Delete folder “${folder.name}”? Saved videos stay in your library.`)) {
                          void guarded(async () => {
                            await props.onDeleteFolder(folder.id);
                            if (props.filter.folderId === folder.id) {
                              props.onFilterChange({ ...props.filter, folderId: null });
                            }
                          });
                        }
                      }}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
        <form
          className="saved-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!folderDraft.trim()) return;
            const name = folderDraft.trim();
            void guarded(async () => {
              await props.onCreateFolder(name);
              setFolderDraft("");
            });
          }}
        >
          <FolderPlus aria-hidden="true" size={15} />
          <input
            value={folderDraft}
            maxLength={80}
            onChange={(event) => setFolderDraft(event.target.value)}
            placeholder="New folder"
            aria-label="New folder name"
          />
          <button type="submit" disabled={busy || !folderDraft.trim()}>
            Add
          </button>
        </form>
      </div>

      <div className="saved-sidebar-block">
        <div className="saved-sidebar-title">
          <h2>Tags</h2>
          <span className="saved-count">{props.tags.length}</span>
        </div>
        <div className="saved-tag-cloud">
          {props.tags.length === 0 && <p className="saved-muted">No tags yet. Add one to slice across folders.</p>}
          {props.tags.map((tag) =>
            editingTagId === tag.id ? (
              <form
                key={tag.id}
                className="saved-inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void guarded(async () => {
                    await props.onRenameTag(tag.id, renameDraft);
                    setEditingTagId(null);
                  });
                }}
              >
                <input
                  autoFocus
                  value={renameDraft}
                  maxLength={80}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  aria-label={`Rename tag ${tag.name}`}
                />
                <button type="submit" aria-label="Save tag name" disabled={busy}>
                  <Check aria-hidden="true" size={15} />
                </button>
                <button type="button" aria-label="Cancel rename" onClick={() => setEditingTagId(null)}>
                  <X aria-hidden="true" size={15} />
                </button>
              </form>
            ) : (
              <span key={tag.id} className={props.filter.tagId === tag.id ? "saved-chip active" : "saved-chip"}>
                <button
                  type="button"
                  onClick={() =>
                    props.onFilterChange({
                      ...props.filter,
                      tagId: props.filter.tagId === tag.id ? null : tag.id,
                      folderId: null
                    })
                  }
                  aria-pressed={props.filter.tagId === tag.id}
                >
                  <Tag aria-hidden="true" size={12} /> {tag.name}
                  <span className="saved-count">{props.counts.byTag.get(tag.id) || 0}</span>
                </button>
                <button type="button" aria-label={`Rename tag ${tag.name}`} title={`Rename ${tag.name}`} onClick={() => {
                  setEditingTagId(tag.id);
                  setRenameDraft(tag.name);
                }}>
                  <Pencil aria-hidden="true" size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete tag ${tag.name}`}
                  title={`Delete ${tag.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete tag “${tag.name}”? Saved videos keep everything else.`)) {
                      void guarded(async () => {
                        await props.onDeleteTag(tag.id);
                        if (props.filter.tagId === tag.id) {
                          props.onFilterChange({ ...props.filter, tagId: null });
                        }
                      });
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" size={12} />
                </button>
              </span>
            )
          )}
        </div>
        <form
          className="saved-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!tagDraft.trim()) return;
            const name = tagDraft.trim();
            void guarded(async () => {
              await props.onCreateTag(name);
              setTagDraft("");
            });
          }}
        >
          <Tag aria-hidden="true" size={15} />
          <input
            value={tagDraft}
            maxLength={80}
            onChange={(event) => setTagDraft(event.target.value)}
            placeholder="New tag"
            aria-label="New tag name"
          />
          <button type="submit" disabled={busy || !tagDraft.trim()}>
            Add
          </button>
        </form>
      </div>

      {formError && (
        <p className="error saved-inline-error" role="alert">
          {formError}
        </p>
      )}
    </aside>
  );
}

function SavedCard(props: {
  item: SavedItem;
  saved: boolean;
  pending: boolean;
  noteEditing: boolean;
  activeFolderId: string | null;
  activeTagId: string | null;
  onSelectVideo: (video: FeedVideo) => void;
  onToggleSave: (video: FeedVideo) => void;
  onStartNote: () => void;
  onCancelNote: () => void;
  onSaveNote: (note: string) => void;
  onOrganize: () => void;
  onPickFolder: (folderId: string) => void;
  onPickTag: (tagId: string) => void;
  onClearFilter: (next: SavedFilter) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(props.item.note);
  const folderIds = new Set(props.item.folders.map((folder) => folder.id));
  const tagIds = new Set(props.item.tags.map((tag) => tag.id));

  useEffect(() => {
    if (props.noteEditing) {
      setNoteDraft(props.item.note);
    }
  }, [props.noteEditing, props.item.note]);

  return (
    <article className="saved-card" aria-label={props.item.video.title}>
      <div className="thumbnail-wrap">
        <button type="button" className="thumbnail-button" onClick={() => props.onSelectVideo(props.item.video)} aria-label={`Play ${props.item.video.title}`}>
          <img
            src={thumbnailFor(props.item.video)}
            loading="lazy"
            alt=""
            onError={(event) => handleThumbnailError(event, props.item.video.id)}
          />
          {props.item.video.duration && <span className="duration-pill">{props.item.video.duration}</span>}
        </button>
        <button
          type="button"
          className={props.saved ? "saved-toggle active" : "saved-toggle"}
          onClick={() => props.onToggleSave(props.item.video)}
          disabled={props.pending}
          aria-label={props.saved ? `Remove ${props.item.video.title} from saved` : `Save ${props.item.video.title}`}
          title={props.saved ? "Unsave" : "Save"}
        >
          {props.pending ? <Loader2 aria-hidden="true" size={15} className="spin" /> : <Bookmark aria-hidden="true" size={15} fill={props.saved ? "currentColor" : "none"} />}
        </button>
      </div>

      <div className="video-meta saved-meta">
        <h2 title={props.item.video.title}>{props.item.video.title}</h2>
        <div className="channel-line">
          <span className="avatar" aria-hidden="true">{props.item.video.author.slice(0, 1).toUpperCase()}</span>
          <span className="channel-name" title={props.item.video.author}>{props.item.video.author}</span>
        </div>
        <div className="published-line" title={formatPublished(props.item.video)}>
          {formatPublished(props.item.video)}
        </div>

        {(props.item.folders.length > 0 || props.item.tags.length > 0) && (
          <div className="saved-memberships">
            {props.item.folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className={props.activeFolderId === folder.id ? "saved-chip small active" : "saved-chip small"}
                aria-pressed={folderIds.has(folder.id)}
                title={folderIds.has(folder.id) ? `Remove from ${folder.name}` : `Add to ${folder.name}`}
                onClick={() => props.onPickFolder(folder.id)}
              >
                <Folder aria-hidden="true" size={11} /> {folder.name}
              </button>
            ))}
            {props.item.tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={props.activeTagId === tag.id ? "saved-chip small tag active" : "saved-chip small tag"}
                aria-pressed={tagIds.has(tag.id)}
                title={tagIds.has(tag.id) ? `Remove tag ${tag.name}` : `Add tag ${tag.name}`}
                onClick={() => props.onPickTag(tag.id)}
              >
                #{tag.name}
              </button>
            ))}
          </div>
        )}

        <div className="saved-note">
          {props.noteEditing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                props.onSaveNote(noteDraft);
              }}
            >
              <label className="sr-only" htmlFor={`note-${props.item.video.id}`}>
                Note for {props.item.video.title}
              </label>
              <textarea
                id={`note-${props.item.video.id}`}
                autoFocus
                rows={3}
                maxLength={5000}
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="Why did you save this? Key timestamps, quotes, follow-ups…"
              />
              <div className="saved-note-actions">
                <button type="submit" className="action-button" disabled={props.pending}>
                  Save note
                </button>
                <button type="button" className="secondary-button" onClick={props.onCancelNote}>
                  Cancel
                </button>
              </div>
            </form>
          ) : props.item.note ? (
            <button type="button" className="saved-note-view" onClick={props.onStartNote} aria-label={`Edit note for ${props.item.video.title}`}>
              <StickyNote aria-hidden="true" size={14} />
              <span>{props.item.note}</span>
            </button>
          ) : (
            <button type="button" className="saved-note-empty" onClick={props.onStartNote}>
              <StickyNote aria-hidden="true" size={14} /> Add a note
            </button>
          )}
        </div>

        <div className="saved-card-actions">
          <button type="button" className="secondary-button small" onClick={props.onOrganize}>
            Organize
          </button>
          <span className="saved-date" title={new Date(props.item.savedAt).toLocaleString()}>
            Saved {relativeDate(props.item.savedAt)}
          </span>
        </div>
      </div>
    </article>
  );
}

export function OrganizeDialog(props: {
  draft: OrganizeDraft;
  folders: SavedCollection[];
  tags: SavedCollection[];
  onClose: () => void;
  onCreateFolder: (name: string) => Promise<void>;
  onCreateTag: (name: string) => Promise<void>;
  onSave: (folderIds: string[], tagIds: string[], note: string) => void | Promise<void>;
  title?: string;
  submitLabel?: string;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(dialogRef, true, props.onClose);
  const [folderIds, setFolderIds] = useState<string[]>(props.draft.folderIds);
  const [tagIds, setTagIds] = useState<string[]>(props.draft.tagIds);
  const [note, setNote] = useState(props.draft.note || "");
  const [folderDraft, setFolderDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
  }

  async function createInline(kind: "folder" | "tag") {
    const name = (kind === "folder" ? folderDraft : tagDraft).trim();
    if (!name) return;
    setBusy(true);
    setDialogError("");
    try {
      if (kind === "folder") {
        await props.onCreateFolder(name);
        setFolderDraft("");
      } else {
        await props.onCreateTag(name);
        setTagDraft("");
      }
    } catch (caught) {
      setDialogError(caught instanceof Error ? caught.message : "Could not create this collection.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setBusy(true);
    setDialogError("");
    try {
      await props.onSave(folderIds, tagIds, note);
    } catch (caught) {
      setDialogError(caught instanceof Error ? caught.message : "Could not update this saved video.");
    } finally {
      setBusy(false);
    }
  }

  // Folders/tags refresh underneath this dialog after inline creation; selection
  // state intentionally stays local until the user confirms with Save.
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Organize saved video"
        tabIndex={-1}
        className="profile-modal saved-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h1>{props.title || "Organize"}</h1>
            {props.title && <p className="saved-dialog-copy">Choose where this video should live. It starts in Watch Later.</p>}
          </div>
          <button type="button" className="icon-button" aria-label="Close organize dialog" onClick={props.onClose}>
            <X aria-hidden="true" size={17} />
          </button>
        </div>
        <div className="saved-dialog-body">
          <div>
            <h2>Folders</h2>
            <ul className="saved-checklist">
              {props.folders.map((folder) => (
                <li key={folder.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={folderIds.includes(folder.id)}
                      onChange={() => setFolderIds(toggle(folderIds, folder.id))}
                    />
                    {folder.name}
                  </label>
                </li>
              ))}
            </ul>
            <form
              className="saved-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createInline("folder");
              }}
            >
              <input
                value={folderDraft}
                maxLength={80}
                onChange={(event) => setFolderDraft(event.target.value)}
                placeholder="New folder"
                aria-label="New folder name"
              />
              <button type="submit" disabled={busy || !folderDraft.trim()}>
                Add
              </button>
            </form>
          </div>
          <div>
            <h2>Tags</h2>
            <ul className="saved-checklist">
              {props.tags.map((tag) => (
                <li key={tag.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={tagIds.includes(tag.id)}
                      onChange={() => setTagIds(toggle(tagIds, tag.id))}
                    />
                    #{tag.name}
                  </label>
                </li>
              ))}
            </ul>
            <form
              className="saved-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createInline("tag");
              }}
            >
              <input
                value={tagDraft}
                maxLength={80}
                onChange={(event) => setTagDraft(event.target.value)}
                placeholder="New tag"
                aria-label="New tag name"
              />
              <button type="submit" disabled={busy || !tagDraft.trim()}>
                Add
              </button>
            </form>
          </div>
        </div>
        <label className="saved-dialog-note">
          <span>Note <small>optional</small></span>
          <textarea
            rows={3}
            maxLength={5000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add a thought, timestamp, or follow-up…"
          />
        </label>
        {dialogError && (
          <p className="error" role="alert">
            {dialogError}
          </p>
        )}
        <div className="wizard-nav">
          <span className="wizard-count">
            {folderIds.length} folders · {tagIds.length} tags
          </span>
          <button type="button" className="secondary-button" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="wizard-next" onClick={() => void saveDraft()} disabled={busy}>
            {busy ? "Saving…" : props.submitLabel || "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function relativeDate(timestamp: number) {
  const delta = Date.now() - timestamp;
  if (!Number.isFinite(delta) || delta < 0) return "just now";
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
