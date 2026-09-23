import { AsyncLocalStorage } from "node:async_hooks";

type ManagedAuthContext = {
  accessToken: string;
};

const storage = new AsyncLocalStorage<ManagedAuthContext>();

export function withManagedAuth<T>(request: Request, callback: () => T): T {
  const accessToken = request.headers.get("x-supabase-access-token")?.trim() || "";
  return storage.run({ accessToken }, callback);
}

export function getManagedAccessToken() {
  return storage.getStore()?.accessToken || "";
}
