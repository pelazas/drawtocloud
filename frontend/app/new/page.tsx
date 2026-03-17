"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PreGenForm from "@/components/PreGenForm";
import type { PreGenAnswers } from "@/components/PreGenForm/usePreGenForm";
import { useAuth } from "@/components/auth/useAuth";
import { fetchUserEntitlements } from "@/lib/entitlements";
import { startGenerationViaHttp } from "@/lib/generationStart";
import { useQuota } from "@/lib/useQuota";

const QUOTA_EXHAUSTED_MESSAGE = "You've used all 5 free beta generations. Paid plans coming soon!";

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
    async (answers: PreGenAnswers) => {
      if (isQuotaExhausted || isSubmitting) {
        return;
      }

      setSubmitError(null);
      setIsSubmitting(true);

      try {
        const result = await startGenerationViaHttp(answers);
        if (!result.share_slug) {
          throw new Error("Server did not return a shareable link.");
        }

        await router.replace(`/p/${result.share_slug}`);
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
