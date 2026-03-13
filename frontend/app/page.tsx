"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Chat from "@/components/Chat";
import Canvas from "@/components/Canvas";
import TopBar from "@/components/TopBar";
import OutputPanel from "@/components/OutputPanel";
import AgentActivityFeed from "@/components/AgentActivityFeed";
import ProjectsDashboard from "@/components/ProjectsDashboard";
import { useAuth } from "@/components/auth/useAuth";
import { useCanvasPipeline } from "@/lib/useCanvasPipeline";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { CanvasSession, PersistedProject, mapProjectRows, toProjectSummary } from "@/lib/projects";

type AppState = "dashboard" | "canvas";

const FREE_BETA_QUOTA_LIMIT = 5;

function asNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export default function Home() {
  const router = useRouter();
  const [appState, setAppState] = useState<AppState>("dashboard");
  const [canvasSession, setCanvasSession] = useState<CanvasSession | null>(null);
  const [projects, setProjects] = useState<PersistedProject[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  const [generationsUsed, setGenerationsUsed] = useState(0);
  const [generationsLimit, setGenerationsLimit] = useState(FREE_BETA_QUOTA_LIMIT);
  const [quotaLoading, setQuotaLoading] = useState(true);

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

  const fetchProjects = useCallback(async (): Promise<PersistedProject[]> => {
    if (!user) {
      setProjects([]);
      return [];
    }

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Failed to load projects:", error);
      setProjects([]);
      return [];
    }

    const mappedProjects = mapProjectRows(data);
    setProjects(mappedProjects);
    return mappedProjects;
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const loadInitialState = async () => {
      if (!user) {
        if (!cancelled) {
          setProjects([]);
          setCanvasSession(null);
          setAppState("dashboard");
          setInitialLoading(false);
        }
        return;
      }

      setInitialLoading(true);
      await refreshQuota();
      await fetchProjects();

      if (cancelled) return;

      setCanvasSession(null);
      setAppState("dashboard");
      setInitialLoading(false);
    };

    void loadInitialState();

    return () => {
      cancelled = true;
    };
  }, [user, refreshQuota, fetchProjects]);

  const remainingGenerations = Math.max(generationsLimit - generationsUsed, 0);

  const projectSummaries = useMemo(() => projects.map(toProjectSummary), [projects]);

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
    onNodesChange,
    onEdgesChange,
    handleSend,
  } = useCanvasPipeline(appState, canvasSession, refreshQuota);

  function handleOpenProject(projectId: string) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;
    setCanvasSession({ mode: "existing", project });
    setAppState("canvas");
  }

  function handleNewGeneration() {
    router.push("/new");
  }

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-300 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          Loading your projects...
        </div>
      </div>
    );
  }

  if (appState === "dashboard") {
    return (
      <ProjectsDashboard
        projects={projectSummaries}
        remainingGenerations={remainingGenerations}
        generationLimit={generationsLimit}
        quotaLoading={quotaLoading}
        onOpenProject={handleOpenProject}
        onNewGeneration={handleNewGeneration}
      />
    );
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <div className="w-80 flex-shrink-0">
        <Chat onSend={handleSend} messages={messages} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          message={pipelineStatus}
          remainingGenerations={remainingGenerations}
          generationLimit={generationsLimit}
          quotaLoading={quotaLoading}
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
