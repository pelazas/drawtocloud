"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Chat from "@/components/Chat";
import Canvas from "@/components/Canvas";
import TopBar from "@/components/TopBar";
import OutputPanel from "@/components/OutputPanel";
import AgentActivityFeed from "@/components/AgentActivityFeed";
import { useAuth } from "@/components/auth/useAuth";
import { fetchUserEntitlements } from "@/lib/entitlements";
import { useCanvasPipeline } from "@/lib/useCanvasPipeline";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { CanvasSession, PersistedProject, mapProjectRow } from "@/lib/projects";

const FREE_BETA_QUOTA_LIMIT = 5;
const STALE_WS_THRESHOLD_MS = 10_000;

type Props = {
  slug: string;
  initialProject: PersistedProject;
};

function asNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function pollIntervalForElapsed(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 2_000;
  if (elapsedMs < 120_000) return 5_000;
  return 10_000;
}

export default function ProjectBySlugClient({ slug, initialProject }: Props) {
  const { user } = useAuth();

  const [project, setProject] = useState<PersistedProject>(initialProject);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [generationsUsed, setGenerationsUsed] = useState(0);
  const [generationsLimit, setGenerationsLimit] = useState(FREE_BETA_QUOTA_LIMIT);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [entitlementsLoading, setEntitlementsLoading] = useState(true);
  const pollModeRef = useRef<string>("off");
  const pollIntervalRef = useRef<number | null>(null);
  const nextPollAtRef = useRef<number>(0);

  const isOwner = Boolean(user?.id && project.userId && user.id === project.userId);

  const refreshQuota = useCallback(async () => {
    if (!user) {
      setGenerationsUsed(0);
      setGenerationsLimit(FREE_BETA_QUOTA_LIMIT);
      setQuotaLoading(false);
      return;
    }

    setQuotaLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { data, error: quotaError } = await supabase
      .from("profiles")
      .select("generations_used, generations_limit")
      .eq("id", user.id)
      .single();

    if (quotaError || !data) {
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

  const fetchProject = useCallback(
    async (background = false) => {
      if (!background) {
        setLoading(true);
      }

      const supabase = getSupabaseBrowserClient();
      const { data, error: projectError } = await supabase
        .from("projects")
        .select("*")
        .eq("share_slug", slug)
        .single();

      if (projectError || !data) {
        if (!background) {
          setError("Project not found.");
          setLoading(false);
        }
        return;
      }

      const mapped = mapProjectRow(data);
      if (!mapped) {
        if (!background) {
          setError("Project payload is invalid.");
          setLoading(false);
        }
        return;
      }

      setError(null);
      setProject((prev) => {
        if (
          prev.id === mapped.id &&
          prev.updatedAt === mapped.updatedAt &&
          prev.nodes.length === mapped.nodes.length &&
          prev.edges.length === mapped.edges.length &&
          prev.terraformFiles.length === mapped.terraformFiles.length &&
          prev.generationStatus === mapped.generationStatus &&
          prev.generationStage === mapped.generationStage &&
          prev.generationError === mapped.generationError &&
          prev.generationTraceId === mapped.generationTraceId &&
          prev.generationStartedAt === mapped.generationStartedAt &&
          prev.generationCompletedAt === mapped.generationCompletedAt &&
          prev.lastEventAt === mapped.lastEventAt &&
          prev.projectMode === mapped.projectMode
        ) {
          return prev;
        }
        return mapped;
      });

      if (!background) {
        setLoading(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    void Promise.all([refreshQuota(), refreshEntitlements()]);
  }, [refreshQuota, refreshEntitlements]);

  useEffect(() => {
    void fetchProject(true);
  }, [fetchProject]);

  const canvasSession: CanvasSession = useMemo(
    () => ({ mode: "existing", project }),
    [project]
  );

  const handleGenerationComplete = useCallback(async () => {
    await fetchProject(true);
    await refreshQuota();
  }, [fetchProject, refreshQuota]);

  const remainingGenerations = Math.max(generationsLimit - generationsUsed, 0);
  const effectiveQuotaLoading = quotaLoading || entitlementsLoading;

  const {
    nodes,
    edges,
    fitViewTrigger,
    messages,
    pipelineStatus,
    budgetRetryState,
    terraformFiles,
    costEstimate,
    archDescription,
    isGenerating,
    agentLogs,
    generationElapsed,
    wsState,
    debugEvents,
    currentStage,
    traceId,
    lastEventAt,
    terraformProgress,
    handleReconnect,
    copyDebugReport,
    recordDebugEvent,
    isChatStreaming,
    chatEnabled,
    chatDisabledReason,
    generationCompleted,
    setupPdfState,
    requestSetupPdfGeneration,
    requestSetupPdfDownload,
    selectedNodeIds,
    selectedNodes,
    deselectNode,
    onNodesChange,
    onEdgesChange,
    handleSend,
    handleApprovePlan,
    pendingArchitecturePlanId,
    handleDeleteNodes,
    isDiscoveryMode,
  } = useCanvasPipeline("canvas", canvasSession, handleGenerationComplete, undefined, {
    liveSession: isOwner,
    readOnly: !isOwner,
  });

  useEffect(() => {
    const generationActive = project.generationStatus === "queued" || project.generationStatus === "running";

    if (!generationActive) {
      if (pollModeRef.current !== "off") {
        recordDebugEvent("poll_stop", {
          details: { poll_mode: "off", reason: "generation_terminal_or_idle" },
        });
      }
      pollModeRef.current = "off";
      pollIntervalRef.current = null;
      nextPollAtRef.current = 0;
      return;
    }

    const timer = setInterval(() => {
      const now = Date.now();
      const wsDisconnected = wsState !== "open";
      const wsStale = !wsDisconnected && (!!lastEventAt ? now - lastEventAt > STALE_WS_THRESHOLD_MS : true);
      const fallbackNeeded = !isOwner || wsDisconnected || wsStale;

      if (!fallbackNeeded) {
        if (pollModeRef.current !== "ws_live") {
          recordDebugEvent("poll_stop", {
            details: { poll_mode: "ws_live", reason: "ws_healthy" },
          });
        }
        pollModeRef.current = "ws_live";
        pollIntervalRef.current = null;
        nextPollAtRef.current = 0;
        return;
      }

      const startedAtMs = project.generationStartedAt ? Date.parse(project.generationStartedAt) : now;
      const elapsedMs = Number.isFinite(startedAtMs) ? Math.max(now - startedAtMs, 0) : 0;
      const intervalMs = pollIntervalForElapsed(elapsedMs);
      const mode = isOwner ? `fallback_${intervalMs}ms` : `readonly_${intervalMs}ms`;

      if (pollModeRef.current !== mode) {
        recordDebugEvent(pollModeRef.current.startsWith("fallback_") ? "poll_backoff" : "poll_start", {
          details: {
            poll_mode: mode,
            reason: isOwner ? (wsDisconnected ? "ws_disconnected" : "ws_stale") : "readonly_public_mode",
            interval_ms: intervalMs,
          },
        });
        pollModeRef.current = mode;
      }

      if (pollIntervalRef.current !== intervalMs) {
        pollIntervalRef.current = intervalMs;
        nextPollAtRef.current = 0;
      }

      if (nextPollAtRef.current !== 0 && now < nextPollAtRef.current) {
        return;
      }

      nextPollAtRef.current = now + intervalMs;
      void fetchProject(true);
    }, 1000);

    return () => clearInterval(timer);
  }, [fetchProject, isOwner, lastEventAt, project.generationStartedAt, project.generationStatus, recordDebugEvent, wsState]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-300 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          Loading project...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-300 flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <p>{error}</p>
          <Link
            href="/"
            className="inline-flex items-center rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <div className="w-64 sm:w-80 lg:w-[24rem] xl:w-[26rem] flex-shrink-0">
        <Chat
          onSend={handleSend}
          onAcceptAndGenerate={handleApprovePlan}
          approveDisabled={
            isDiscoveryMode
              ? isGenerating || !chatEnabled
              : !pendingArchitecturePlanId || isGenerating || !chatEnabled
          }
          messages={messages}
          disabled={!chatEnabled}
          isTyping={isChatStreaming}
          disabledReason={chatDisabledReason}
          selectedNodes={selectedNodes}
          onDeselectNode={deselectNode}
          readOnly={!isOwner}
        />
      </div>

      <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
        <TopBar
          message={pipelineStatus}
          remainingGenerations={remainingGenerations}
          generationLimit={generationsLimit}
          quotaLoading={effectiveQuotaLoading}
          isAdmin={isOwner && isAdmin}
          wsState={wsState}
          currentStage={currentStage}
          traceId={traceId}
          lastEventAt={lastEventAt}
          budgetRetryState={budgetRetryState}
          debugEvents={debugEvents}
          onReconnect={handleReconnect}
          onCopyDebug={copyDebugReport}
          mode={isOwner ? "owner" : "public"}
          shareSlug={isOwner ? project.shareSlug : null}
          showBackToDashboard={Boolean(user)}
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
            readOnly={!isOwner}
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
        setupPdfState={setupPdfState}
        setupPdfGenerationReady={generationCompleted}
        onGenerateSetupPdf={requestSetupPdfGeneration}
        onDownloadSetupPdf={requestSetupPdfDownload}
        readOnly={!isOwner}
      />
    </div>
  );
}
