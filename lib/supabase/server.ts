import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client authenticated with the service role key.
 * MUST only be invoked from server-side code (Route Handlers, Server Actions,
 * Server Components). Never expose the service role key to the browser.
 */
export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase env vars missing: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
    global: {
      headers: { 'x-application': 'derma-copilot' },
    },
  });

  return cached;
}
