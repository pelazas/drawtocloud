"use client";

import { RefreshCw } from "lucide-react";
import AgentStepCard from "@/components/GenerationObservabilityPanel/AgentStepCard";
import type { GenerationAgentState } from "@/lib/generationObservability";
import { buildCoderAgentStateFromProgress } from "@/lib/terraformGenerationObservability";
import type { AgentLogEntry } from "@/lib/useCanvasPipeline";
import type { TerraformProgress } from "@/components/TerraformViewer";

type Props = {
  agents: GenerationAgentState[] | null;
  initialAgents: GenerationAgentState[] | null;
  agentLogs: AgentLogEntry[];
  isGenerating: boolean;
  generationElapsed?: number;
  terraformProgress?: TerraformProgress;
  isManualTerraformRun?: boolean;
};

function formatTotalElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function rowOwnsConnector(rowIndex: number, allRows: GenerationAgentState[]): boolean {
  const row = allRows[rowIndex];
  if (row.agent === "coder") return false;
  const archRowsBefore = allRows.slice(0, rowIndex + 1).filter(r => r.agent !== "coder").length;
  const totalArchRows = allRows.filter(r => r.agent !== "coder").length;
  return archRowsBefore < totalArchRows;
}

export default function GenerationObservabilityPanel({
  agents,
  initialAgents,
  agentLogs,
  isGenerating,
  generationElapsed,
  terraformProgress,
  isManualTerraformRun = false,
}: Props) {
  const presentation = buildCoderAgentStateFromProgress(terraformProgress, initialAgents, isManualTerraformRun, agents);

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
        {allRows.map((agent, index) => {
          const latestLog = agentLogs
            .filter((log) => log.agent === agent.agent)
            .pop();
          const ownsConnector = rowOwnsConnector(index, allRows);
          return (
            <div key={agent.agent} className="relative">
              <AgentStepCard
                agent={agent}
                latestLog={latestLog?.message}
              />
              {ownsConnector && (
                <div className="absolute left-[19px] top-full w-px h-4 bg-gray-800 -mt-1" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
