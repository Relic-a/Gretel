import type { SupportedStorage } from "@supabase/supabase-js";

const authStoreFile = "supabase-auth.json";

type TauriStore = Awaited<ReturnType<typeof import("@tauri-apps/plugin-store")["load"]>>;

let storePromise: Promise<TauriStore> | null = null;

export function getSupabaseAuthStorage(): SupportedStorage | undefined {
  if (!isTauri()) return undefined;

  return {
    async getItem(key) {
      const store = await getStore();
      const storedValue = await store.get<unknown>(key);
      if (typeof storedValue === "string") return storedValue;

      // Preserve a session created by an older build when the updated app is
      // first opened on the same localhost origin.
      const legacyValue = window.localStorage.getItem(key);
      if (legacyValue !== null) {
        await store.set(key, legacyValue);
        await store.save();
      }
      return legacyValue;
    },
    async setItem(key, value) {
      const store = await getStore();
      await store.set(key, value);
      await store.save();
    },
    async removeItem(key) {
      const store = await getStore();
      await store.delete(key);
      await store.save();
      window.localStorage.removeItem(key);
    }
  };
}

function getStore() {
  if (!storePromise) {
    storePromise = import("@tauri-apps/plugin-store").then(({ load }) =>
      load(authStoreFile, { autoSave: false })
    );
  }
  return storePromise;
}

function isTauri() {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}
