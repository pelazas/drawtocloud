"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Chat from "@/components/Chat";
import Canvas from "@/components/Canvas";
import PreGenForm from "@/components/PreGenForm";
import type { PreGenAnswers } from "@/components/PreGenForm/usePreGenForm";
import TopBar from "@/components/TopBar";
import OutputPanel from "@/components/OutputPanel";
import AgentActivityFeed from "@/components/AgentActivityFeed";
import { useAuth } from "@/components/auth/useAuth";
import { fetchUserEntitlements } from "@/lib/entitlements";
import { useCanvasPipeline } from "@/lib/useCanvasPipeline";
import { CanvasSession } from "@/lib/projects";
import { useQuota } from "@/lib/useQuota";

type AppState = "pre_gen" | "canvas";

const QUOTA_EXHAUSTED_MESSAGE = "You've used all 5 free beta generations. Paid plans coming soon!";

export default function NewGenerationPage() {
  const router = useRouter();
  const [appState, setAppState] = useState<AppState>("pre_gen");
  const [canvasSession, setCanvasSession] = useState<CanvasSession | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [entitlementsLoading, setEntitlementsLoading] = useState(true);
  const { user } = useAuth();

  const { generationsUsed, generationsLimit, quotaLoading, refreshQuota } = useQuota(user);

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
    selectedNodeIds,
    onNodesChange,
    onEdgesChange,
    handleSend,
    handleDeleteNodes,
    triggerGeneration,
    isDiscoveryMode,
  } = useCanvasPipeline(
    appState,
    canvasSession,
    refreshQuota,
    handleProjectReady
  );

  function handlePreGenSubmit(answers: PreGenAnswers, mode: "fast_path" | "chat_first") {
    if (isQuotaExhausted) return;
    const sessionAnswers = answers as Record<string, string | string[]>;
    if (mode === "fast_path") {
      setCanvasSession({ mode: "new", answers: sessionAnswers, projectId: null, shareSlug: null });
    } else {
      setCanvasSession({ mode: "chat_first", answers: sessionAnswers, projectId: null, shareSlug: null });
    }
    setAppState("canvas");
  }

  if (appState === "pre_gen") {
    return (
      <PreGenForm
        onSubmit={handlePreGenSubmit}
        remainingGenerations={remainingGenerations}
        generationLimit={generationsLimit}
        quotaLoading={effectiveQuotaLoading}
        isAdmin={isAdmin}
        quotaExhaustedMessage={QUOTA_EXHAUSTED_MESSAGE}
      />
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
          onAcceptAndGenerate={isDiscoveryMode ? () => { void triggerGeneration(); } : undefined}
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
            selectedNodeIds={selectedNodeIds}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onDeleteNodes={handleDeleteNodes}
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
