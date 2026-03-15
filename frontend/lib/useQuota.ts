import { useCallback, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { asNonNegativeInt } from "@/lib/utils";

export const FREE_BETA_QUOTA_LIMIT = 5;

export function useQuota(user: User | null) {
  const [generationsUsed, setGenerationsUsed] = useState(0);
  const [generationsLimit, setGenerationsLimit] = useState(FREE_BETA_QUOTA_LIMIT);
  const [quotaLoading, setQuotaLoading] = useState(true);

  const refreshQuota = useCallback(async () => {
    if (!user) {
      setGenerationsUsed(0);
      setGenerationsLimit(FREE_BETA_QUOTA_LIMIT);
      setQuotaLoading(false);
      return;
    }

    setQuotaLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("generations_used, generations_limit")
      .eq("id", user.id)
      .single();

    if (error || !data) {
      console.error("Failed to load quota:", error);
      setGenerationsUsed(0);
      setGenerationsLimit(FREE_BETA_QUOTA_LIMIT);
      setQuotaLoading(false);
      return;
    }

    setGenerationsUsed(asNonNegativeInt(data.generations_used, 0));
    setGenerationsLimit(asNonNegativeInt(data.generations_limit, FREE_BETA_QUOTA_LIMIT));
    setQuotaLoading(false);
  }, [user]);

  return { generationsUsed, generationsLimit, quotaLoading, refreshQuota };
}
