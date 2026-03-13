"use client";

import { useCallback, useEffect, useState } from "react";
import Chat from "@/components/Chat";
import Canvas from "@/components/Canvas";
import Questionnaire from "@/components/Questionnaire";
import TopBar from "@/components/TopBar";
import OutputPanel from "@/components/OutputPanel";
import AgentActivityFeed from "@/components/AgentActivityFeed";
import { useAuth } from "@/components/auth/useAuth";
import { useCanvasPipeline } from "@/lib/useCanvasPipeline";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

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

export default function Home() {
  const [appState, setAppState] = useState<AppState>("questionnaire");
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<Record<string, string | string[]>>({});
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

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);

  const remainingGenerations = Math.max(generationsLimit - generationsUsed, 0);
  const isQuotaExhausted = !quotaLoading && remainingGenerations <= 0;

  const {
    nodes,
    edges,
    fitViewTrigger,
    messages,
    pipelineStatus,
    terraformFiles,
    costEstimate,
    archDescription,
    isGenerating,
    agentLogs,
    generationElapsed,
    onNodesChange,
    onEdgesChange,
    handleSend,
  } = useCanvasPipeline(appState, questionnaireAnswers, refreshQuota);

  function handleQuestionnaireComplete(answers: Record<string, string | string[]>) {
    if (isQuotaExhausted) return;
    setQuestionnaireAnswers(answers);
    setAppState("canvas");
  }

  if (appState === "questionnaire") {
    return (
      <Questionnaire
        onComplete={handleQuestionnaireComplete}
        remainingGenerations={remainingGenerations}
        generationLimit={generationsLimit}
        quotaLoading={quotaLoading}
        quotaExhaustedMessage={QUOTA_EXHAUSTED_MESSAGE}
      />
    );
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Chat panel — left */}
      <div className="w-80 flex-shrink-0">
        <Chat onSend={handleSend} messages={messages} />
      </div>

      {/* Canvas — center */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          message={pipelineStatus}
          remainingGenerations={remainingGenerations}
          generationLimit={generationsLimit}
          quotaLoading={quotaLoading}
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

      {/* Output Panel — right */}
      <OutputPanel
        terraformFiles={terraformFiles}
        costEstimate={costEstimate}
        archDescription={archDescription}
        isGenerating={isGenerating}
      />
    </div>
  );
}
