"use client";

import { FormEvent, useRef, useState } from "react";

import type { UserSettings } from "../types";
import type { GretelAccess } from "./use-gretel-auth";
import { useDialogFocus } from "./use-dialog-focus";

type SettingsModalProps = {
  settings: UserSettings;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (event: FormEvent, settings: UserSettings) => void;
  account: { email?: string; isAnonymous?: boolean } | null;
  access: GretelAccess | null;
  authPending: boolean;
  accessRefreshing: boolean;
  accessError: string;
  accessUpdatedAt: number | null;
  onRefreshAccess: () => void;
  onGoogle: () => void;
  onSignOut: () => void;
};

export function SettingsModal(props: SettingsModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<UserSettings>(props.settings);
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.settings);
  const close = () => {
    if (props.saving) return;
    if (confirmClose) {
      setConfirmClose(false);
      return;
    }
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    props.onClose();
  };
  useDialogFocus(dialogRef, true, close);

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
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
          <button type="button" className="icon-button" onClick={close}>
            Close
          </button>
        </div>

        <form onSubmit={(event) => props.onSubmit(event, draft)} className="setup-form">
          {confirmClose && dirty && (
            <div className="settings-unsaved" role="alert">
              <strong>Save your changes?</strong>
              <p>Your access choice will return to the saved setting if you leave now.</p>
              <div>
                <button type="submit" disabled={props.saving}>Save and close</button>
                <button type="button" onClick={props.onClose}>Discard changes</button>
                <button type="button" onClick={() => setConfirmClose(false)}>Keep editing</button>
              </div>
            </div>
          )}
          <div className="embedding-source-setting">
            <div>
              <h2>Embedding access</h2>
              <p>Use Gretel’s managed allowance or connect your own OpenRouter account.</p>
            </div>
            <div className="embedding-source-options" role="radiogroup" aria-label="Embedding access">
              <button
                type="button"
                role="radio"
                aria-checked={draft.embeddingMode !== "byok"}
                className={draft.embeddingMode !== "byok" ? "active" : ""}
                onClick={() => props.account
                  ? setDraft({ ...draft, embeddingMode: "managed" })
                  : props.onGoogle()}
                disabled={props.authPending}
              >
                <span>Managed by Gretel</span>
                <small>{props.account ? "No API key required" : "Connect Google to use"}</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={draft.embeddingMode === "byok"}
                className={draft.embeddingMode === "byok" ? "active" : ""}
                onClick={() => setDraft({ ...draft, embeddingMode: "byok" })}
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
                    ? `${props.accessError || props.accessRefreshing ? "Last known: " : ""}${props.access.usedInputs.toLocaleString()} used · ${props.access.remainingInputs.toLocaleString()} of ${props.access.monthlyInputLimit.toLocaleString()} remaining this month`
                    : props.accessError ? "Managed usage is unavailable." : props.accessRefreshing ? "Loading managed usage…" : "Managed access is not active."}
                </small>
                {props.accessError && <small className="error" role="status">Usage could not refresh: {props.accessError}</small>}
                {props.accessUpdatedAt && !props.accessError && <small>Updated {new Date(props.accessUpdatedAt).toLocaleTimeString()}</small>}
                {draft.embeddingMode === "byok" && <small>Managed usage is paused while your OpenRouter key is selected.</small>}
                {props.access?.active && <small>Cached inputs do not use your monthly allowance.</small>}
              </div>
              <button type="button" onClick={props.onRefreshAccess} disabled={props.accessRefreshing}>
                {props.accessRefreshing ? "Refreshing…" : "Refresh usage"}
              </button>
              <button type="button" onClick={props.onSignOut} disabled={props.authPending}>Sign out</button>
            </div>
          )}

          <p className="modal-copy">Only the selected access method is used. Your OpenRouter key stays on this computer when saved.</p>

          <label>
            <span>OpenRouter API key</span>
            <small>Stored locally as plain text in <code>data/user-settings.json</code>. Use a dedicated key with a spending limit.</small>
            <input
              type="password"
              autoFocus={draft.embeddingMode === "byok"}
              autoComplete="off"
              maxLength={512}
              spellCheck={false}
              value={draft.openRouterApiKey === "set" ? "" : draft.openRouterApiKey || ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  openRouterApiKey: event.target.value
                })
              }
              placeholder={draft.openRouterApiKey === "set" ? "API key already saved" : "sk-or-v1-..."}
              disabled={draft.embeddingMode !== "byok"}
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
              value={draft.openRouterModel || ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
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
                checked={draft.developerAnalytics === true}
                onChange={(event) =>
                  setDraft({
                    ...draft,
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
            {props.saving ? "Saving..." : dirty ? "Save changes" : "Close settings"}
          </button>
          {props.error && <p className="error">{props.error}</p>}
        </form>
      </section>
    </div>
  );
}
