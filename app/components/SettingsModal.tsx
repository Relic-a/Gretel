"use client";

import { FormEvent } from "react";

import type { UserSettings } from "../types";

type SettingsModalProps = {
  settings: UserSettings;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (settings: UserSettings) => void;
};

export function SettingsModal(props: SettingsModalProps) {
  return (
    <div className="modal-backdrop">
      <section className="profile-modal settings-modal">
        <div className="modal-head">
          <h1>Settings</h1>
          <button type="button" className="icon-button" onClick={props.onClose}>
            Close
          </button>
        </div>

        <form onSubmit={props.onSubmit} className="setup-form">
          <p className="modal-copy">Save your OpenRouter key here so embedding requests work without restarting the app.</p>

          <label>
            <span>OpenRouter API key</span>
            <small>Stored in <code>data/user-settings.json</code> and read on each embedding request.</small>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={props.settings.openRouterApiKey === "set" ? "" : props.settings.openRouterApiKey || ""}
              onChange={(event) =>
                props.onChange({
                  ...props.settings,
                  openRouterApiKey: event.target.value
                })
              }
              placeholder={props.settings.openRouterApiKey === "set" ? "API key already saved" : "sk-or-v1-..."}
            />
          </label>

          <label>
            <span>OpenRouter model</span>
            <small>Optional override. Leave blank to keep the model from <code>config/gretel.config.json</code>.</small>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={props.settings.openRouterModel || ""}
              onChange={(event) =>
                props.onChange({
                  ...props.settings,
                  openRouterModel: event.target.value
                })
              }
              placeholder="openai/text-embedding-3-small"
            />
          </label>

          <button type="submit" disabled={props.saving}>
            {props.saving ? "Saving..." : "Save settings"}
          </button>
          {props.error && <p className="error">{props.error}</p>}
        </form>
      </section>
    </div>
  );
}
