import { FormEvent, useEffect, useMemo, useState } from "react";

import type { ChannelResult, Profile, UserSettings } from "../types";
import { normalize } from "./video-utils";
import { TagEditor } from "./TagEditor";
import { FeedBuildProgress } from "./FeedBuildProgress";

type StepId = "name" | "topics" | "channels" | "key";

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
  onAddChannel: (value: string) => void;
  onRemoveChannel: (value: string) => void;
  onDeleteProfile: (profileId: string) => void;
};

const stepCopy: Record<StepId, { title: string; help: string }> = {
  name: {
    title: "Name this profile",
    help: "You can run several profiles side by side — one per project, mood, or person."
  },
  topics: {
    title: "What are you into?",
    help: "Add topics and Gretel will hunt for videos around them. You can add more later."
  },
  channels: {
    title: "Any channels you already trust?",
    help: "Optional. Channels you follow seed your feed with videos they publish."
  },
  key: {
    title: "Connect OpenRouter",
    help: "Gretel needs your API key to build the first feed. It stays on your machine."
  }
};

export function ProfileModal(props: ProfileModalProps) {
  const steps = useMemo(() => {
    const list: { id: StepId; label: string }[] = [
      { id: "name", label: "Name" },
      { id: "topics", label: "Topics" },
      { id: "channels", label: "Channels" }
    ];

    if (props.needsOpenRouterKey) {
      list.push({ id: "key", label: "API key" });
    }

    return list;
  }, [props.needsOpenRouterKey]);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep((current) => Math.min(current, steps.length - 1));
  }, [steps.length]);

  const activeStep = steps[Math.min(step, steps.length - 1)];
  const isLast = step === steps.length - 1;

  function canContinue() {
    if (activeStep.id === "name") {
      return props.profileName.trim().length > 0;
    }

    if (activeStep.id === "key") {
      return (
        props.settings.openRouterApiKey === "set" ||
        (props.settings.openRouterApiKey || "").trim().length > 0
      );
    }

    return true;
  }

  function stepIsEmpty() {
    if (activeStep.id === "topics") {
      return props.tags.length === 0 && !props.tagDraft.trim();
    }

    if (activeStep.id === "channels") {
      return props.channels.length === 0 && !props.channelDraft.trim();
    }

    return false;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (props.loading) {
      return;
    }

    if (!isLast) {
      if (canContinue()) {
        setStep(step + 1);
      }
      return;
    }

    props.onSubmit(event);
  }

  const topicSuggestions = props.topicSuggestions.filter(
    (suggestion) => !props.tags.some((tag) => normalize(tag) === normalize(suggestion))
  );
  const nextLabel = isLast
    ? props.manageProfiles
      ? "Add profile"
      : "Create profile"
    : stepIsEmpty()
      ? "Skip"
      : "Next";

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

        {props.loading ? (
          <FeedBuildProgress
            variant="compact"
            profileName={props.profileName}
            tags={props.tags}
            channels={props.channels}
            loadingLabel={props.loadingLabel}
          />
        ) : (
          <form onSubmit={handleSubmit} className="setup-form">
            <ol className="wizard-tracker" aria-label="Setup steps">
              {steps.map((entry, index) => (
                <li
                  key={entry.id}
                  className={index < step ? "done" : index === step ? "current" : ""}
                  aria-current={index === step ? "step" : undefined}
                >
                  <span className="wizard-dot" aria-hidden="true">
                    {index < step ? "✓" : index + 1}
                  </span>
                  <span className="wizard-label">{entry.label}</span>
                </li>
              ))}
            </ol>

            <div className="wizard-body">
              <div className="wizard-step-head">
                <h2>{stepCopy[activeStep.id].title}</h2>
                <p>{stepCopy[activeStep.id].help}</p>
              </div>

              {activeStep.id === "name" && (
                <label>
                  <span>Profile name</span>
                  <input
                    autoFocus
                    value={props.profileName}
                    onChange={(event) => props.onProfileNameChange(event.target.value)}
                    placeholder="e.g. Systems design"
                  />
                </label>
              )}

              {activeStep.id === "topics" && (
                <>
                  <TagEditor
                    label="Topics"
                    helperText="Press Enter or comma after each topic. Click a tag to remove it."
                    values={props.tags}
                    draft={props.tagDraft}
                    setDraft={props.onTagDraftChange}
                    addValue={props.onAddTag}
                    removeValue={props.onRemoveTag}
                    placeholder="Add a topic"
                    suggestions={topicSuggestions}
                  />
                </>
              )}

              {activeStep.id === "channels" && (
                <>
                  <TagEditor
                    label="Subscriptions"
                    helperText="Search for a channel, then click it to add it."
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
                        <button
                          type="button"
                          key={channel.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => props.onAddChannel(channel.name)}
                        >
                          {channel.thumbnailUrl && <img src={channel.thumbnailUrl} alt="" />}
                          <span>{channel.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {activeStep.id === "key" && (
                <>
                  <label>
                    <span>OpenRouter API key</span>
                    <input
                      autoFocus
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
            </div>

            <div className="wizard-nav">
              <span className="wizard-count">
                {step + 1} / {steps.length}
              </span>
              {step > 0 && (
                <button type="button" className="secondary-button" onClick={() => setStep(step - 1)}>
                  Back
                </button>
              )}
              <button type="submit" className="wizard-next" disabled={!canContinue()}>
                {nextLabel}
              </button>
            </div>

            {props.error && <p className="error">{props.error}</p>}
          </form>
        )}
      </section>
    </div>
  );
}
