"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Chat from "@/components/Chat";
import Canvas from "@/components/Canvas";
import Questionnaire from "@/components/Questionnaire";
import TopBar from "@/components/TopBar";
import OutputPanel from "@/components/OutputPanel";
import AgentActivityFeed from "@/components/AgentActivityFeed";
import { useAuth } from "@/components/auth/useAuth";
import { fetchUserEntitlements } from "@/lib/entitlements";
import { useCanvasPipeline } from "@/lib/useCanvasPipeline";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { CanvasSession } from "@/lib/projects";

type AppState = "questionnaire" | "canvas";

const FREE_BETA_QUOTA_LIMIT = 5;
const QUOTA_EXHAUSTED_MESSAGE = "You've used all 5 free beta generations. Paid plans coming soon!";

function asNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export default function NewGenerationPage() {
  const router = useRouter();
  const [appState, setAppState] = useState<AppState>("questionnaire");
  const [canvasSession, setCanvasSession] = useState<CanvasSession | null>(null);
  const [generationsUsed, setGenerationsUsed] = useState(0);
  const [generationsLimit, setGenerationsLimit] = useState(FREE_BETA_QUOTA_LIMIT);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [entitlementsLoading, setEntitlementsLoading] = useState(true);
  const { user } = useAuth();

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

  const remainingGenerations = Math.max(generationsLimit - generationsUsed, 0);
  const effectiveQuotaLoading = quotaLoading || entitlementsLoading;
  const isQuotaExhausted = !isAdmin && !effectiveQuotaLoading && remainingGenerations <= 0;
  const handleProjectReady = useCallback((projectId: string, shareSlug: string | null) => {
    setCanvasSession((prev) => {
      if (!prev || prev.mode !== "new") return prev;
      return { ...prev, projectId, shareSlug };
    });

    if (shareSlug) {
      router.replace(`/p/${shareSlug}`);
    }
  }, [router]);

  const {
    nodes,
    edges,
    fitViewTrigger,
    messages,
    pipelineStatus,
    terraformFiles,
    costEstimate,
    archDescription,
    terraformProgress,
    isGenerating,
    agentLogs,
    generationElapsed,
    wsState,
    statusTicker,
    debugEvents,
    currentStage,
    traceId,
    lastEventAt,
    handleReconnect,
    copyDebugReport,
    isChatStreaming,
    chatEnabled,
    chatDisabledReason,
    onNodesChange,
    onEdgesChange,
    handleSend,
  } = useCanvasPipeline(
    appState,
    canvasSession,
    refreshQuota,
    handleProjectReady
  );

  function handleQuestionnaireComplete(answers: Record<string, string | string[]>) {
    if (isQuotaExhausted) return;
    setCanvasSession({ mode: "new", answers, projectId: null, shareSlug: null });
    setAppState("canvas");
  }

  if (appState === "questionnaire") {
    return (
      <div className="relative">
        <div className="fixed right-6 top-4 z-[70]">
          <Link
            href="/"
            className="inline-flex items-center rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
        <Questionnaire
          onComplete={handleQuestionnaireComplete}
          remainingGenerations={remainingGenerations}
          generationLimit={generationsLimit}
          quotaLoading={effectiveQuotaLoading}
          isAdmin={isAdmin}
          quotaExhaustedMessage={QUOTA_EXHAUSTED_MESSAGE}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <div className="w-80 flex-shrink-0">
        <Chat
          onSend={handleSend}
          messages={messages}
          disabled={!chatEnabled}
          isTyping={isChatStreaming}
          disabledReason={chatDisabledReason}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          message={pipelineStatus}
          remainingGenerations={remainingGenerations}
          generationLimit={generationsLimit}
          quotaLoading={effectiveQuotaLoading}
          isAdmin={isAdmin}
          ticker={statusTicker}
          wsState={wsState}
          currentStage={currentStage}
          traceId={traceId}
          lastEventAt={lastEventAt}
          debugEvents={debugEvents}
          onReconnect={handleReconnect}
          onCopyDebug={copyDebugReport}
        />
        <div className="flex-1 overflow-hidden relative">
          <Canvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitViewTrigger={fitViewTrigger}
          />
          <AgentActivityFeed
            logs={agentLogs}
            isGenerating={isGenerating}
            nodeCount={nodes.length}
            fileCount={terraformFiles.length}
            costTotal={costEstimate?.monthly_total ?? null}
            generationElapsed={generationElapsed}
          />
        </div>
      </div>

      <OutputPanel
        terraformFiles={terraformFiles}
        costEstimate={costEstimate}
        archDescription={archDescription}
        isGenerating={isGenerating}
        terraformProgress={terraformProgress}
      />
    </div>
  );
}
