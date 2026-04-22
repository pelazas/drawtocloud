import { useCallback, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getLlmKeyStatus } from "@/lib/llmKeys";
import { asNonNegativeInt } from "@/lib/utils";

export const FREE_BETA_QUOTA_LIMIT = 5;

function isNetworkError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const msg = (error as { message?: string }).message ?? "";
    return msg.includes("Failed to fetch") || msg.includes("NetworkError");
  }
  return false;
}

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

    let quotaResult;
    try {
      quotaResult = await supabase
        .from("profiles")
        .select("generations_used, generations_limit")
        .eq("id", user.id)
        .single();
    } catch (err) {
      quotaResult = { data: null, error: err };
    }

    const keyStatus = await getLlmKeyStatus().catch(() => ({ has_key: false }));

    const { data, error } = quotaResult;

    if (error || !data) {
      if (isNetworkError(error)) {
        // Silently fall back on network errors (ad-blockers, offline, etc.)
      } else {
        console.error("Failed to load quota:", error);
      }
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
