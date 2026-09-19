"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { getSupabaseClient } from "../../lib/supabase-client";
import { SUPABASE_EMBED_FUNCTION_URL, SUPABASE_PUBLISHABLE_KEY } from "../../lib/supabase-config";

export const managedAccessTokenKey = "gretel.supabaseAccessToken.v1";

export type GretelAccess = {
  active: boolean;
  plan: string | null;
  source: string | null;
  monthlyInputLimit: number;
  usedInputs: number;
  remainingInputs: number;
  expiresAt: string | null;
  isAnonymous: boolean;
};

export function useGretelAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<GretelAccess | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const callbackInFlight = useRef(false);

  const refreshAccess = useCallback(async (nextSession?: Session | null) => {
    const currentSession = nextSession === undefined
      ? (await getSupabaseClient().auth.getSession()).data.session
      : nextSession;
    setSession(currentSession);
    persistAccessToken(currentSession?.access_token || "");

    if (!currentSession) {
      setAccess(null);
      return null;
    }

    const response = await invokeGateway(currentSession, { action: "status" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not verify your Gretel access.");
    setAccess(body);
    return body as GretelAccess;
  }, []);

  const handleCallbackUrl = useCallback(async (callbackUrl: string) => {
    if (callbackInFlight.current) return;
    const parsed = new URL(callbackUrl);
    const code = parsed.searchParams.get("code");
    if (!code) return;

    callbackInFlight.current = true;
    setPending(true);
    setError("");
    try {
      const flowId = parsed.searchParams.get("sb_flow_id") || undefined;
      const { data, error: exchangeError } = await getSupabaseClient().auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined
      );
      if (exchangeError) throw exchangeError;
      await refreshAccess(data.session);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google sign-in could not be completed.");
    } finally {
      callbackInFlight.current = false;
      setPending(false);
    }
  }, [refreshAccess]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const supabase = getSupabaseClient();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (disposed) return;
      setSession(nextSession);
      persistAccessToken(nextSession?.access_token || "");
      window.setTimeout(() => {
        if (!disposed) void refreshAccess(nextSession).catch(() => undefined);
      }, 0);
    });

    void (async () => {
      try {
        const currentUrl = window.location.href;
        if (new URL(currentUrl).searchParams.has("code")) {
          await handleCallbackUrl(currentUrl);
        } else {
          await refreshAccess();
        }

        if (isTauri()) {
          const deepLink = await import("@tauri-apps/plugin-deep-link");
          const current = await deepLink.getCurrent();
          const currentUrl = current?.find((value) => value.startsWith("gretel://auth/callback"));
          if (currentUrl) await handleCallbackUrl(currentUrl);
          unlisten = await deepLink.onOpenUrl((urls) => {
            const callbackUrl = urls.find((value) => value.startsWith("gretel://auth/callback"));
            if (callbackUrl) void handleCallbackUrl(callbackUrl);
          });
        }
      } catch (caught) {
        if (!disposed) setError(caught instanceof Error ? caught.message : "Could not restore your Gretel session.");
      } finally {
        if (!disposed) setReady(true);
      }
    })();

    return () => {
      disposed = true;
      listener.subscription.unsubscribe();
      unlisten?.();
    };
  }, [handleCallbackUrl, refreshAccess]);

  const signInWithGoogle = useCallback(async () => {
    setPending(true);
    setError("");
    try {
      const redirectTo = isTauri()
        ? "gretel://auth/callback"
        : `${window.location.origin}${window.location.pathname}`;
      const { data, error: oauthError } = await getSupabaseClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true }
      });
      if (oauthError) throw oauthError;
      if (!data.url) throw new Error("Supabase did not return a Google sign-in URL.");

      if (isTauri()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(data.url);
        setPending(false);
      } else {
        window.location.assign(data.url);
      }
    } catch (caught) {
      setPending(false);
      setError(caught instanceof Error ? caught.message : "Google sign-in could not be started.");
    }
  }, []);

  const redeemAccessCode = useCallback(async (code: string) => {
    setPending(true);
    setError("");
    try {
      let currentSession = (await getSupabaseClient().auth.getSession()).data.session;
      if (!currentSession) {
        const { data, error: anonymousError } = await getSupabaseClient().auth.signInAnonymously();
        if (anonymousError) throw anonymousError;
        currentSession = data.session;
      }
      if (!currentSession) throw new Error("Could not create an access-code session.");

      const response = await invokeGateway(currentSession, { action: "redeem", code });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "That access code could not be redeemed.");
      await refreshAccess(currentSession);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That access code could not be redeemed.");
      return false;
    } finally {
      setPending(false);
    }
  }, [refreshAccess]);

  const signOut = useCallback(async () => {
    setPending(true);
    setError("");
    try {
      await getSupabaseClient().auth.signOut();
      persistAccessToken("");
      setSession(null);
      setAccess(null);
    } finally {
      setPending(false);
    }
  }, []);

  return {
    session,
    access,
    ready,
    pending,
    error,
    setError,
    signInWithGoogle,
    redeemAccessCode,
    refreshAccess,
    signOut
  };
}

function invokeGateway(session: Session, body: Record<string, unknown>) {
  return fetch(SUPABASE_EMBED_FUNCTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function persistAccessToken(token: string) {
  try {
    if (token) window.localStorage.setItem(managedAccessTokenKey, token);
    else window.localStorage.removeItem(managedAccessTokenKey);
  } catch {}
}

function isTauri() {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}
