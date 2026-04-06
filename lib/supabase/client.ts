import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

let cachedClient: SupabaseClient | null = null;

const getRequiredPublicEnv = (name: typeof SUPABASE_URL_ENV | typeof SUPABASE_ANON_KEY_ENV): string => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Governed Supabase read client requires ${name}.`);
  }

  return value;
};

export const getSupabaseReadClient = (): SupabaseClient => {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = createClient(
    getRequiredPublicEnv(SUPABASE_URL_ENV),
    getRequiredPublicEnv(SUPABASE_ANON_KEY_ENV),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

  return cachedClient;
};
