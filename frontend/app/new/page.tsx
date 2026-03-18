"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PreGenForm from "@/components/PreGenForm";
import type { PreGenAnswers } from "@/components/PreGenForm/usePreGenForm";
import { useAuth } from "@/components/auth/useAuth";
import { fetchUserEntitlements } from "@/lib/entitlements";
import {
  resolveProjectRedirectPath,
  startDiscoverySession,
  startGenerationViaHttp,
} from "@/lib/generationStart";
import { useQuota } from "@/lib/useQuota";

const QUOTA_EXHAUSTED_MESSAGE = "You've used all 5 free beta generations. Paid plans coming soon!";
const GENERIC_DESCRIPTIONS = new Set(["app", "application", "web app", "mobile app", "saas app", "my app", "demo", "test"]);

function hasSufficientContext(answers: PreGenAnswers): boolean {
  const description = typeof answers.description === "string" ? answers.description.trim() : "";
  if (!description) return false;

  if (GENERIC_DESCRIPTIONS.has(description.toLowerCase())) return false;

  if (description.length < 30) return false;

  const wordCount = (description.match(/[A-Za-z0-9_]+/g) ?? []).length;
  if (wordCount < 6) return false;

  return true;
}

export default function NewGenerationPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { generationsUsed, generationsLimit, quotaLoading, refreshQuota } = useQuota(user);
  const [isAdmin, setIsAdmin] = useState(false);
  const [entitlementsLoading, setEntitlementsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const remainingGenerations = Math.max(generationsLimit - generationsUsed, 0);
  const effectiveQuotaLoading = quotaLoading || entitlementsLoading;
  const isQuotaExhausted = !isAdmin && !effectiveQuotaLoading && remainingGenerations <= 0;

  const refreshEntitlements = useCallback(async () => {
    if (!user) {
      setIsAdmin(false);
      setEntitlementsLoading(false);
      return;
    }

    setEntitlementsLoading(true);
    const entitlements = await fetchUserEntitlements();
    setIsAdmin(entitlements.isAdmin);
    setEntitlementsLoading(false);
  }, [user]);

  useEffect(() => {
    void Promise.all([refreshQuota(), refreshEntitlements()]);
  }, [refreshQuota, refreshEntitlements]);

  const handlePreGenSubmit = useCallback(
    async (answers: PreGenAnswers, mode: "fast_path" | "chat_first") => {
      if (isQuotaExhausted || isSubmitting) {
        return;
      }

      setSubmitError(null);
      setIsSubmitting(true);

      try {
        const needsDiscovery = mode === "chat_first" || !hasSufficientContext(answers);
        if (needsDiscovery) {
          const discovery = await startDiscoverySession(answers);
          await router.replace(resolveProjectRedirectPath(discovery.share_slug));
          return;
        }

        const result = await startGenerationViaHttp(answers);
        await router.replace(resolveProjectRedirectPath(result.share_slug));
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "Failed to start generation.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [isQuotaExhausted, isSubmitting, router]
  );

  return (
    <PreGenForm
      onSubmit={handlePreGenSubmit}
      remainingGenerations={remainingGenerations}
      generationLimit={generationsLimit}
      quotaLoading={effectiveQuotaLoading}
      isAdmin={isAdmin}
      quotaExhaustedMessage={QUOTA_EXHAUSTED_MESSAGE}
      isSubmitting={isSubmitting}
      submitError={submitError}
    />
  );
}
