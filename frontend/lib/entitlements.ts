import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type UserEntitlements = {
  isAdmin: boolean;
};

export async function fetchUserEntitlements(): Promise<UserEntitlements> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return { isAdmin: false };
  }

  try {
    const response = await fetch(`${API_URL}/api/me/entitlements`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return { isAdmin: false };
    }

    const payload = (await response.json()) as { is_admin?: unknown };
    return { isAdmin: payload.is_admin === true };
  } catch {
    return { isAdmin: false };
  }
}
