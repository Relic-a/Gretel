"use client";

import { FormEvent, useRef } from "react";

import type { UserSettings } from "../types";
import { useDialogFocus } from "./use-dialog-focus";

type SettingsModalProps = {
  settings: UserSettings;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (settings: UserSettings) => void;
};

export function SettingsModal(props: SettingsModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, true, props.onClose);

  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="profile-modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabIndex={-1}
      >
        <div className="modal-head">
          <h1 id="settings-dialog-title">Settings</h1>
          <button type="button" className="icon-button" onClick={props.onClose}>
            Close
          </button>
        </div>

        <form onSubmit={props.onSubmit} className="setup-form">
          <p className="modal-copy">Save your OpenRouter key here so embedding requests work without restarting the app.</p>

          <label>
            <span>OpenRouter API key</span>
            <small>Stored locally as plain text in <code>data/user-settings.json</code>. Use a dedicated key with a spending limit.</small>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              maxLength={512}
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
              maxLength={200}
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

          <div className="developer-setting">
            <div>
              <span>Developer analytics</span>
              <small>Record local performance traces and show the diagnostics shortcut. Off by default.</small>
            </div>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={props.settings.developerAnalytics === true}
                onChange={(event) =>
                  props.onChange({
                    ...props.settings,
                    developerAnalytics: event.target.checked
                  })
                }
              />
              <span className="toggle-track" aria-hidden="true">
                <span className="toggle-knob" />
              </span>
              <span className="sr-only">Enable developer analytics</span>
            </label>
          </div>

          <div className="developer-setting">
            <div>
              <span>App updates</span>
              <small>Gretel checks automatically after launch. Updates are downloaded only after you approve them.</small>
            </div>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("gretel:check-for-updates"))}
            >
              Check now
            </button>
          </div>

          <button type="submit" disabled={props.saving}>
            {props.saving ? "Saving..." : "Save settings"}
          </button>
          {props.error && <p className="error">{props.error}</p>}
        </form>
      </section>
    </div>
  );
}
