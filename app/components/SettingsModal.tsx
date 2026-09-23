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

function UnsavedConfirm(props: { saving: boolean; onDiscard: () => void; onKeepEditing: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, true, props.onKeepEditing);

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onKeepEditing();
      }}
    >
      <section
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="settings-unsaved-title"
        aria-describedby="settings-unsaved-copy"
        tabIndex={-1}
      >
        <h2 id="settings-unsaved-title">Save your changes?</h2>
        <p id="settings-unsaved-copy">Your access choice will return to the saved setting if you leave now.</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-keep" onClick={props.onKeepEditing}>Keep editing</button>
          <button type="button" className="confirm-discard" onClick={props.onDiscard}>Discard changes</button>
          <button type="submit" className="confirm-save" disabled={props.saving}>
            {props.saving ? "Saving…" : "Save and close"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function SettingsModal(props: SettingsModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<UserSettings>(props.settings);
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.settings);
  const access = props.access;
  const accountLabel = props.account?.isAnonymous
    ? "Access-code session"
    : props.account?.email || "Google account";
  const accessStale = Boolean(props.accessError) || props.accessRefreshing;
  const usagePercent = access && access.monthlyInputLimit > 0
    ? Math.min(100, Math.max(0, Math.round((access.usedInputs / access.monthlyInputLimit) * 100)))
    : 0;
  const updatedLabel = props.accessUpdatedAt
    ? new Date(props.accessUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
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
  useDialogFocus(dialogRef, !confirmClose, close, !confirmClose);

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
            <UnsavedConfirm
              saving={props.saving}
              onDiscard={props.onClose}
              onKeepEditing={() => setConfirmClose(false)}
            />
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
            <div className="account-card">
              <div className="account-card-head">
                <div className="account-identity">
                  <span className="account-email" title={accountLabel}>{accountLabel}</span>
                  {access?.active && (
                    <span className={`account-badge${accessStale ? " is-stale" : ""}`}>
                      {accessStale ? "Last known" : "Managed access"}
                    </span>
                  )}
                </div>
                <button type="button" className="account-signout" onClick={props.onSignOut} disabled={props.authPending}>
                  Sign out
                </button>
              </div>

              {access?.active ? (
                <>
                  <div className="usage-figures">
                    <strong>{access.remainingInputs.toLocaleString()}</strong>
                    <span>of {access.monthlyInputLimit.toLocaleString()} embeddings left this month</span>
                  </div>
                  <div
                    className="usage-meter"
                    role="progressbar"
                    aria-label="Monthly embedding usage"
                    aria-valuemin={0}
                    aria-valuemax={access.monthlyInputLimit}
                    aria-valuenow={Math.min(access.usedInputs, access.monthlyInputLimit)}
                  >
                    <span style={{ width: `${usagePercent}%` }} />
                  </div>
                  <div className="usage-foot">
                    <span>{access.usedInputs.toLocaleString()} used</span>
                    {updatedLabel && <span className="usage-updated">Updated {updatedLabel}</span>}
                    <button
                      type="button"
                      className="usage-refresh"
                      onClick={props.onRefreshAccess}
                      disabled={props.accessRefreshing}
                    >
                      {props.accessRefreshing ? "Refreshing…" : "Refresh"}
                    </button>
                  </div>
                  {draft.embeddingMode === "byok" && (
                    <p className="account-note">Managed usage is paused while your OpenRouter key is selected.</p>
                  )}
                  <p className="account-note subtle">Cached inputs don’t count toward your monthly allowance.</p>
                </>
              ) : (
                <p className="account-note">
                  {props.accessRefreshing ? "Loading managed usage…" : "Managed access is not active."}
                </p>
              )}

              {props.accessError && (
                <p className="account-note error" role="status">Usage could not refresh: {props.accessError}</p>
              )}
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
