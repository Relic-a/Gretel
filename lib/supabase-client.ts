"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAuthStorage } from "./supabase-auth-storage";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-config";

let client: SupabaseClient | null = null;

export function getSupabaseClient() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: getSupabaseAuthStorage()
      }
    });
  }
  return client;
}
