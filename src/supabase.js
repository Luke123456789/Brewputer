import { createClient } from "@supabase/supabase-js";

// The publishable key is designed to be public: row level security decides what it can see.
const url = import.meta.env.VITE_SUPABASE_URL || "https://csyfmrpnvrcoiroddqud.supabase.co";
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_i1VmIT4icxBYeydaMT3_7w_GtOhHDjd";

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
