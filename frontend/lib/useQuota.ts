import { useCallback, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getLlmKeyStatus } from "@/lib/llmKeys";
import { asNonNegativeInt } from "@/lib/utils";

export const FREE_BETA_QUOTA_LIMIT = 5;

export function useQuota(user: User | null) {
  const [generationsUsed, setGenerationsUsed] = useState(0);
  const [generationsLimit, setGenerationsLimit] = useState(FREE_BETA_QUOTA_LIMIT);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [quotaLoading, setQuotaLoading] = useState(true);

  const refreshQuota = useCallback(async () => {
    if (!user) {
      setGenerationsUsed(0);
      setGenerationsLimit(FREE_BETA_QUOTA_LIMIT);
      setHasApiKey(false);
      setQuotaLoading(false);
      return;
    }

    setQuotaLoading(true);
    const supabase = getSupabaseBrowserClient();

    const [quotaResult, keyStatus] = await Promise.all([
      supabase
        .from("profiles")
        .select("generations_used, generations_limit")
        .eq("id", user.id)
        .single(),
      getLlmKeyStatus().catch(() => ({ has_key: false })),
    ]);

    const { data, error } = quotaResult;

    if (error || !data) {
      console.error("Failed to load quota:", error);
      setGenerationsUsed(0);
      setGenerationsLimit(FREE_BETA_QUOTA_LIMIT);
    } else {
      setGenerationsUsed(asNonNegativeInt(data.generations_used, 0));
      setGenerationsLimit(asNonNegativeInt(data.generations_limit, FREE_BETA_QUOTA_LIMIT));
    }

    setHasApiKey(keyStatus.has_key);
    setQuotaLoading(false);
  }, [user]);

  return { generationsUsed, generationsLimit, hasApiKey, quotaLoading, refreshQuota };
}
