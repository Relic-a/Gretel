import { FormEvent } from "react";

import type { ChannelResult, Profile, UserSettings } from "../types";
import { TagEditor } from "./TagEditor";

type ProfileModalProps = {
  manageProfiles: boolean;
  feedOpen: boolean;
  profiles: Profile[];
  profileName: string;
  tags: string[];
  channels: string[];
  tagDraft: string;
  channelDraft: string;
  channelResults: ChannelResult[];
  loading: boolean;
  error: string;
  needsOpenRouterKey: boolean;
  settings: UserSettings;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onSettingsChange: (settings: UserSettings) => void;
  onProfileNameChange: (value: string) => void;
  onTagDraftChange: (value: string) => void;
  onChannelDraftChange: (value: string) => void;
  onAddTag: (value: string) => void;
  onRemoveTag: (value: string) => void;
  onAddChannel: (value: string) => void;
  onRemoveChannel: (value: string) => void;
  onDeleteProfile: (profileId: string) => void;
};

export function ProfileModal(props: ProfileModalProps) {
  return (
    <div className="modal-backdrop">
      <section className="profile-modal">
        <div className="modal-head">
          <h1>{props.manageProfiles ? "Manage profiles" : "Create a profile"}</h1>
          {props.feedOpen && (
            <button type="button" className="icon-button" onClick={props.onClose}>
              Close
            </button>
          )}
        </div>

        {props.manageProfiles && (
          <div className="profile-list">
            <strong>Your profiles ({props.profiles.length})</strong>
            {props.profiles.map((profile) => (
              <div className="profile-row" key={profile.id}>
                <span><span className="profile-avatar small" aria-hidden="true" />{profile.name}</span>
                <button type="button" className="icon-button danger-icon" onClick={() => props.onDeleteProfile(profile.id)} aria-label={`Delete ${profile.name}`}>
                  ⌫
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={props.onSubmit} className="setup-form">
          {props.manageProfiles && <h2>Add a new profile</h2>}
          {!props.manageProfiles && <p className="modal-copy">Tell us what you're into. We'll build your personalized feed.</p>}
          <label>
            <span>Profile name</span>
            <small>Give your profile a name so you can easily switch between them.</small>
            <input
              value={props.profileName}
              onChange={(event) => props.onProfileNameChange(event.target.value)}
              placeholder="Profile name"
            />
          </label>

          {props.needsOpenRouterKey && (
            <>
              <label>
                <span>OpenRouter API key</span>
                <small>Required before Gretel can build your first feed.</small>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={props.settings.openRouterApiKey || ""}
                  onChange={(event) =>
                    props.onSettingsChange({
                      ...props.settings,
                      openRouterApiKey: event.target.value
                    })
                  }
                  placeholder="sk-or-v1-..."
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

          <TagEditor
            label="Topics"
            values={props.tags}
            draft={props.tagDraft}
            setDraft={props.onTagDraftChange}
            addValue={props.onAddTag}
            removeValue={props.onRemoveTag}
            placeholder="Add a topic"
          />

          <TagEditor
            label="Subscriptions"
            values={props.channels}
            draft={props.channelDraft}
            setDraft={props.onChannelDraftChange}
            addValue={props.onAddChannel}
            removeValue={props.onRemoveChannel}
            placeholder="Search channel"
          />

          {props.channelResults.length > 0 && (
            <div className="channel-results">
              {props.channelResults.map((channel) => (
                <button type="button" key={channel.id} onClick={() => props.onAddChannel(channel.name)}>
                  {channel.thumbnailUrl && <img src={channel.thumbnailUrl} alt="" />}
                  <span>{channel.name}</span>
                </button>
              ))}
            </div>
          )}

          <button type="submit" disabled={props.loading}>
            {props.loading ? "Building feed..." : "Add profile"}
          </button>
          {props.loading && <div className="progress-bar" />}
          {props.error && <p className="error">{props.error}</p>}
        </form>
      </section>
    </div>
  );
}
