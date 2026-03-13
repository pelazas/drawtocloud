import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

// Backward-compatible singleton export for client-side code.
export const supabase = getSupabaseBrowserClient();
