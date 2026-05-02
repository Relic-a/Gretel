import { FormEvent } from "react";

import type { ChannelResult, Profile } from "../types";
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
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
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
            {props.profiles.map((profile) => (
              <div className="profile-row" key={profile.id}>
                <span>{profile.name}</span>
                <button type="button" className="danger-button" onClick={() => props.onDeleteProfile(profile.id)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={props.onSubmit} className="setup-form">
          <input
            value={props.profileName}
            onChange={(event) => props.onProfileNameChange(event.target.value)}
            placeholder="Profile name"
          />

          <TagEditor
            label="Tags"
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
