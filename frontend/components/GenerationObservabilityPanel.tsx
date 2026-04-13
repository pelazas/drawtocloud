"use client";

import { RefreshCw } from "lucide-react";
import AgentStepCard from "@/components/GenerationObservabilityPanel/AgentStepCard";
import type { GenerationAgentState } from "@/lib/generationObservability";
import { deriveTerraformGenerationPresentation } from "@/lib/terraformGenerationObservability";
import type { AgentLogEntry } from "@/lib/useCanvasPipeline";
import type { TerraformProgress } from "@/components/TerraformViewer";

type Props = {
  agents: GenerationAgentState[] | null;
  initialAgents: GenerationAgentState[] | null;
  agentLogs: AgentLogEntry[];
  isGenerating: boolean;
  generationElapsed?: number;
  terraformProgress?: TerraformProgress;
};

function formatTotalElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function GenerationObservabilityPanel({
  agents,
  initialAgents,
  agentLogs,
  isGenerating,
  generationElapsed,
  terraformProgress,
}: Props) {
  const presentation = deriveTerraformGenerationPresentation(terraformProgress, initialAgents);

  const allRows = presentation.coderRow
    ? [...(initialAgents ?? []), presentation.coderRow]
    : (agents ?? []);

  if (allRows.length === 0) {
    if (isGenerating) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-gray-500">
            <RefreshCw size={20} className="animate-spin" />
            <span className="text-xs">Starting generation...</span>
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-xs text-gray-500">No generation data.</span>
      </div>
    );
  }

  const allComplete = allRows.every(
    (a) => a.status === "completed" || a.status === "failed" || a.status === "blocked",
  );
  const activeAgents = allRows.filter((a) => a.status === "running");
  const failedAgents = allRows.filter((a) => a.status === "failed");

  let headerText = "Three AI steps are building your AWS architecture.";
  if (allComplete) {
    headerText = failedAgents.length > 0
      ? "Generation completed with errors."
      : "Your architecture has been generated.";
  } else if (activeAgents.length > 0) {
    headerText = `${activeAgents.map((a) => a.label).join(", ")} in progress...`;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-500">{headerText}</p>
        {isGenerating && generationElapsed !== undefined && (
          <span className="text-[10px] text-gray-600 font-mono">
            {formatTotalElapsed(generationElapsed)}
          </span>
        )}
      </div>
      <div className="relative space-y-1">
        {presentation.connectedRowCount > 1 && (
          <div
            className="absolute left-[19px] top-8 w-px bg-gray-800"
            style={{ bottom: `calc(100% - ${presentation.connectedRowCount * 3.5 + 2}rem)` }}
          />
        )}
        {allRows.map((agent) => {
          const latestLog = agentLogs
            .filter((log) => log.agent === agent.agent)
            .pop();
          return (
            <AgentStepCard
              key={agent.agent}
              agent={agent}
              latestLog={latestLog?.message}
            />
          );
        })}
      </div>
    </div>
  );
}
