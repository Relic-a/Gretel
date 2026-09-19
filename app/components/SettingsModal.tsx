"use client";

import { FormEvent, useRef } from "react";

import type { UserSettings } from "../types";
import type { GretelAccess } from "./use-gretel-auth";
import { useDialogFocus } from "./use-dialog-focus";

type SettingsModalProps = {
  settings: UserSettings;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (settings: UserSettings) => void;
  account: { email?: string; isAnonymous?: boolean } | null;
  access: GretelAccess | null;
  authPending: boolean;
  onGoogle: () => void;
  onSignOut: () => void;
};

export function SettingsModal(props: SettingsModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, true, props.onClose);

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
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
          <div className="embedding-source-setting">
            <div>
              <h2>Embedding access</h2>
              <p>Use Gretel’s managed allowance or connect your own OpenRouter account.</p>
            </div>
            <div className="embedding-source-options" role="radiogroup" aria-label="Embedding access">
              <button
                type="button"
                role="radio"
                aria-checked={props.settings.embeddingMode !== "byok"}
                className={props.settings.embeddingMode !== "byok" ? "active" : ""}
                onClick={() => props.account
                  ? props.onChange({ ...props.settings, embeddingMode: "managed" })
                  : props.onGoogle()}
                disabled={props.authPending}
              >
                <span>Managed by Gretel</span>
                <small>{props.account ? "No API key required" : "Connect Google to use"}</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={props.settings.embeddingMode === "byok"}
                className={props.settings.embeddingMode === "byok" ? "active" : ""}
                onClick={() => props.onChange({ ...props.settings, embeddingMode: "byok" })}
              >
                <span>My OpenRouter key</span>
                <small>You cover provider usage</small>
              </button>
            </div>
          </div>

          {props.account && (
            <div className="account-setting">
              <div>
                <span>{props.account.isAnonymous ? "Access-code session" : props.account.email || "Google account"}</span>
                <small>
                  {props.access?.active
                    ? `${props.access.remainingInputs.toLocaleString()} of ${props.access.monthlyInputLimit.toLocaleString()} managed inputs remaining this month`
                    : "Managed access is not active."}
                </small>
              </div>
              <button type="button" onClick={props.onSignOut} disabled={props.authPending}>Sign out</button>
            </div>
          )}

          <p className="modal-copy">Your OpenRouter key remains an optional fallback and is stored only on this computer.</p>

          <label>
            <span>OpenRouter API key</span>
            <small>Stored locally as plain text in <code>data/user-settings.json</code>. Use a dedicated key with a spending limit.</small>
            <input
              type="password"
              autoFocus={props.settings.embeddingMode === "byok"}
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
              disabled={props.settings.embeddingMode !== "byok"}
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
