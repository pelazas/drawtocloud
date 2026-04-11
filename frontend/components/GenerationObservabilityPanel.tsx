"use client";

import { RefreshCw } from "lucide-react";
import AgentStepCard from "@/components/GenerationObservabilityPanel/AgentStepCard";
import type { GenerationAgentState } from "@/lib/generationObservability";

type Props = {
  agents: GenerationAgentState[] | null;
  isGenerating: boolean;
  generationElapsed?: number;
};

function formatTotalElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function GenerationObservabilityPanel({ agents, isGenerating, generationElapsed }: Props) {
  if (!agents) {
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

  const allComplete = agents.every(
    (a) => a.status === "completed" || a.status === "failed" || a.status === "blocked",
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-500">
          {allComplete
            ? "Your architecture has been generated."
            : "Three AI steps are building your AWS architecture."}
        </p>
        {isGenerating && generationElapsed !== undefined && (
          <span className="text-[10px] text-gray-600 font-mono">
            {formatTotalElapsed(generationElapsed)}
          </span>
        )}
      </div>
      <div className="relative space-y-1">
        {agents.length > 1 && (
          <div className="absolute left-[19px] top-8 bottom-8 w-px bg-gray-800" />
        )}
        {agents.map((agent) => (
          <AgentStepCard
            key={agent.agent}
            agent={agent}
          />
        ))}
      </div>
    </div>
  );
}
