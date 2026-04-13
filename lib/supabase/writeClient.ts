import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";

let cachedWriteClient: SupabaseClient | null = null;

export const getSupabaseWriteClient = (): SupabaseClient => {
  if (cachedWriteClient) {
    return cachedWriteClient;
  }

  const url = process.env[SUPABASE_URL_ENV]?.trim();
  const key = process.env[SUPABASE_SERVICE_ROLE_KEY_ENV]?.trim();

  if (!url) {
    throw new Error(`Supabase write client requires ${SUPABASE_URL_ENV}.`);
  }

  if (!key) {
    throw new Error(`Supabase write client requires ${SUPABASE_SERVICE_ROLE_KEY_ENV}.`);
  }

  cachedWriteClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return cachedWriteClient;
};
