import { ArrowLeft, Plus, Search, Trash2, X } from "lucide-react";
import { profileInitials } from "./profile-identity";
import { FormEvent, useEffect, useId, useRef, useState } from "react";

import type { ChannelResult, Profile, UserSettings } from "../types";
import { normalize } from "./video-utils";
import { TagEditor } from "./TagEditor";
import { FeedBuildProgress } from "./FeedBuildProgress";
import { useDialogFocus } from "./use-dialog-focus";
import { usePopoverDismissal } from "./use-popover-dismissal";

type ProfileModalProps = {
  manageProfiles: boolean;
  feedOpen: boolean;
  profiles: Profile[];
  profileName: string;
  tags: string[];
  channels: ChannelResult[];
  tagDraft: string;
  channelDraft: string;
  channelResults: ChannelResult[];
  isSearchingChannels?: boolean;
  loading: boolean;
  loadingLabel: string;
  error: string;
  needsOpenRouterKey: boolean;
  settings: UserSettings;
  topicSuggestions: string[];
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onSettingsChange: (settings: UserSettings) => void;
  onProfileNameChange: (value: string) => void;
  onTagDraftChange: (value: string) => void;
  onChannelDraftChange: (value: string) => void;
  onAddTag: (value: string) => void;
  onRemoveTag: (value: string) => void;
  onAddChannel: (channel: ChannelResult) => void;
  onRemoveChannel: (value: string) => void;
  onDeleteProfile: (profileId: string) => void;
};

function ChannelAvatar({ name, url }: { name: string; url?: string }) {
  return (
    <span className="profile-channel-avatar" aria-hidden="true">
      {profileInitials(name).slice(0, 1)}
      {url && <img src={url} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
    </span>
  );
}

export function ProfileModal(props: ProfileModalProps) {
  const [creating, setCreating] = useState(!props.manageProfiles);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [channelResultsOpen, setChannelResultsOpen] = useState(false);
  const channelId = useId();
  const channelListId = `${channelId}-results`;
  const showResults = channelResultsOpen && props.channelDraft.trim().length >= 2;
  const nameRef = useRef<HTMLInputElement>(null);
  const channelInputRef = useRef<HTMLInputElement>(null);
  const channelEditorRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, props.feedOpen, props.onClose);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (props.loading && creating) dialogRef.current?.focus();
      else if (creating) nameRef.current?.focus();
      else dialogRef.current?.querySelector<HTMLButtonElement>(".profile-list-head button")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [creating, props.loading]);
  usePopoverDismissal(channelEditorRef, () => setChannelResultsOpen(false), showResults);

  useEffect(() => {
    setHighlightedIndex(props.channelResults.length > 0 ? 0 : -1);
  }, [props.channelResults]);

  useEffect(() => {
    if (showResults && highlightedIndex >= 0) {
      document.getElementById(`${channelListId}-${highlightedIndex}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [showResults, channelListId, highlightedIndex]);

  function selectChannel(channel: ChannelResult) {
    props.onAddChannel(channel);
    setChannelResultsOpen(false);
    channelInputRef.current?.focus();
  }

  function handleChannelKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (showResults && event.key === "Escape") {
      event.preventDefault();
      setChannelResultsOpen(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = showResults ? props.channelResults[highlightedIndex] : undefined;
      if (selected) selectChannel(selected);
      return;
    }
    const count = props.channelResults.length;
    if (!count || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    setChannelResultsOpen(true);
    setHighlightedIndex((index) => {
      if (!showResults || index < 0) return event.key === "ArrowDown" ? 0 : count - 1;
      return (index + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
    });
  }

  const topicSuggestions = props.topicSuggestions.filter(
    (suggestion) => !props.tags.some((tag) => normalize(tag) === normalize(suggestion))
  );
  return (
    <div
      className="modal-backdrop profile-backdrop"
      onPointerDown={(event) => {
        if (props.feedOpen && event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
        aria-describedby={creating ? "profile-dialog-description" : undefined}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            <h1 id="profile-dialog-title">{creating ? "Create a feed" : "Manage profiles"}</h1>
            {creating && <p id="profile-dialog-description">Pick a few topics or channels to seed your feed.</p>}
          </div>
          {props.feedOpen && (
            <button type="button" className="icon-button" onClick={props.onClose}>
              Close
            </button>
          )}
        </div>

        {props.manageProfiles && !creating && (
          <div className="profile-list">
            <div className="profile-list-head"><strong>Your profiles ({props.profiles.length})</strong><button type="button" className="action-button" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> New profile</button></div>
            <div className="profile-list-scroll">
            {props.profiles.map((profile) => (
              <div className="profile-row" key={profile.id}>
                <span><span className="profile-avatar small" aria-hidden="true">{profileInitials(profile.name)}</span>{profile.name}</span>
                <button type="button" className="icon-button danger-icon" onClick={() => props.onDeleteProfile(profile.id)} aria-label={`Delete ${profile.name}`}>
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            ))}
            </div>
          </div>
        )}

        {creating && (props.loading ? (
          <FeedBuildProgress
            variant="compact"
            profileName={props.profileName}
            tags={props.tags}
            channels={props.channels.map((channel) => channel.name)}
            loadingLabel={props.loadingLabel}
          />
        ) : (
          <form onSubmit={props.onSubmit} className="setup-form profile-form">
            {props.manageProfiles && (
              <button type="button" className="profile-list-return" onClick={() => setCreating(false)}>
                <ArrowLeft size={14} aria-hidden="true" /> All profiles
              </button>
            )}
            <label>
              <span>Name</span>
              <input
                ref={nameRef}
                maxLength={60}
                value={props.profileName}
                onChange={(event) => props.onProfileNameChange(event.target.value)}
                placeholder="e.g. Systems & AI"
              />
            </label>

            <TagEditor
              label="Topics"
              values={props.tags}
              draft={props.tagDraft}
              setDraft={props.onTagDraftChange}
              addValue={props.onAddTag}
              removeValue={props.onRemoveTag}
              placeholder="Add a topic"
              suggestions={topicSuggestions}
            />

            <div ref={channelEditorRef} className="profile-channel-editor">
              <label htmlFor={channelId}>Channels <small>(optional)</small></label>
              <div className="profile-channel-search">
                <Search size={15} aria-hidden="true" />
                <input
                  id={channelId}
                  ref={channelInputRef}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showResults}
                  aria-controls={showResults ? channelListId : undefined}
                  aria-activedescendant={showResults && props.channelResults[highlightedIndex] ? `${channelListId}-${highlightedIndex}` : undefined}
                  autoComplete="off"
                  maxLength={80}
                  placeholder="Search YouTube channels..."
                  value={props.channelDraft}
                  onChange={(event) => {
                    props.onChannelDraftChange(event.target.value);
                    setChannelResultsOpen(true);
                  }}
                  onFocus={() => setChannelResultsOpen(true)}
                  onBlur={() => setChannelResultsOpen(false)}
                  onKeyDown={handleChannelKeyDown}
                />
                {showResults && (
                  <div className="channel-results-popup">
                    <div id={channelListId} role="listbox" aria-label="Channel search results">
                      {props.channelResults.map((channel, index) => (
                        <button
                          id={`${channelListId}-${index}`}
                          type="button"
                          key={channel.id}
                          tabIndex={-1}
                          className={`channel-popup-item${index === highlightedIndex ? " highlighted" : ""}`}
                          role="option"
                          aria-selected={index === highlightedIndex}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectChannel(channel)}
                        >
                          <ChannelAvatar name={channel.name} url={channel.thumbnailUrl} />
                          <span className="channel-popup-name">{channel.name}</span>
                        </button>
                      ))}
                    </div>
                    {props.channelResults.length === 0 && (
                      <div className="channel-popup-status" role="status">
                        {props.isSearchingChannels ? "Searching YouTube channels..." : "No channels found."}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {props.channels.length > 0 && (
                <div className="profile-channel-chips">
                  {props.channels.map((channel) => (
                    <button type="button" key={channel.id} aria-label={`Remove ${channel.name}`} onClick={() => props.onRemoveChannel(channel.name)}>
                      <ChannelAvatar name={channel.name} url={channel.thumbnailUrl} />
                      <span>{channel.name}</span>
                      <X size={12} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {props.needsOpenRouterKey && (
              <>
                <label>
                  <span>OpenRouter API key</span>
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={props.settings.openRouterApiKey === "set" ? "" : props.settings.openRouterApiKey || ""}
                    onChange={(event) =>
                      props.onSettingsChange({
                        ...props.settings,
                        openRouterApiKey: event.target.value
                      })
                    }
                    placeholder={props.settings.openRouterApiKey === "set" ? "API key already saved" : "sk-or-v1-..."}
                  />
                </label>

                <label>
                  <span>OpenRouter model</span>
                  <small>Optional. Leave blank to use the default embedding model.</small>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={props.settings.openRouterModel || ""}
                    onChange={(event) =>
                      props.onSettingsChange({
                        ...props.settings,
                        openRouterModel: event.target.value
                      })
                    }
                    placeholder="qwen/qwen3-embedding-8b"
                  />
                </label>
              </>
            )}

            {props.error && <p className="error" role="alert">{props.error}</p>}
            <button type="submit" className="action-button profile-create-button">Create feed</button>
          </form>
        ))}
      </section>
    </div>
  );
}
