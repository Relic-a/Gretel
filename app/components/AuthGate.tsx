"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, KeyRound, LoaderCircle } from "lucide-react";

type AuthGateProps = {
  pending: boolean;
  error: string;
  onGoogle: () => void;
  onRedeem: (code: string) => Promise<boolean>;
  onUseOwnKey: () => void;
};

export function AuthGate(props: AuthGateProps) {
  const [code, setCode] = useState("");

  async function redeem(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    await props.onRedeem(code);
  }

  return (
    <div className="access-gate" role="dialog" aria-modal="true" aria-labelledby="access-title">
      <section className="access-panel">
        <div className="access-brand" aria-hidden="true">
          <span>G</span>
          <i />
        </div>
        <div className="access-copy">
          <h1 id="access-title">A better feed, without the setup tax.</h1>
          <p>Sign in once and Gretel will handle semantic search securely. Your profiles and watch history stay on this computer.</p>
        </div>

        <button className="google-auth-button" type="button" onClick={props.onGoogle} disabled={props.pending}>
          <GoogleMark />
          <span>Continue with Google</span>
          {props.pending ? <LoaderCircle className="spinner" size={18} /> : <ArrowRight size={18} />}
        </button>

        <div className="access-divider"><span>or use an invite</span></div>

        <form className="access-code-form" onSubmit={redeem}>
          <label htmlFor="gretel-access-code">Access code</label>
          <div>
            <input
              id="gretel-access-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="GRTL-•••••-•••••-•••••-•••••"
              autoComplete="one-time-code"
              spellCheck={false}
              maxLength={40}
              disabled={props.pending}
            />
            <button type="submit" disabled={props.pending || !code.trim()} aria-label="Redeem access code">
              {props.pending ? <LoaderCircle className="spinner" size={18} /> : <KeyRound size={18} />}
              Redeem
            </button>
          </div>
        </form>

        {props.error && <p className="access-error" role="alert">{props.error}</p>}

        <button className="access-byok" type="button" onClick={props.onUseOwnKey} disabled={props.pending}>
          I already have an OpenRouter key
        </button>
        <p className="access-privacy">Google confirms your identity. Gretel never receives your Google password or access to your YouTube account.</p>
      </section>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.36l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.93A6 6 0 0 1 6.07 12c0-.67.12-1.32.32-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.55l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.82 1.5l2.88-2.87A9.66 9.66 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z" />
    </svg>
  );
}

