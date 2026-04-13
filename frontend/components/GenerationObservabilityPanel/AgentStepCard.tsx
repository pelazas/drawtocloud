"use client";

import { useEffect, useState } from "react";
import {
  ClipboardList,
  PenTool,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  CircleDot,
  Ban,
  Code2,
} from "lucide-react";
import AgentStepMiniHistory from "./AgentStepMiniHistory";
import type { GenerationAgentState } from "@/lib/generationObservability";

type Props = {
  agent: GenerationAgentState;
  latestLog?: string;
};

const ROLE_ICONS: Record<string, typeof ClipboardList> = {
  requirements: ClipboardList,
  architect: PenTool,
  cost_analyst: DollarSign,
  coder: Code2,
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
      return <Loader2 size={14} className="text-blue-400 animate-spin" />;
    case "completed":
      return <CheckCircle2 size={14} className="text-green-400" />;
    case "failed":
      return <AlertCircle size={14} className="text-red-400" />;
    case "blocked":
      return <Ban size={14} className="text-gray-600" />;
    case "queued":
    default:
      return <Clock size={14} className="text-gray-500" />;
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function AgentStepCard({ agent, latestLog }: Props) {
  const RoleIcon = ROLE_ICONS[agent.agent] ?? CircleDot;
  const isMuted = agent.status === "blocked" || agent.status === "queued";
  const isActive = agent.status === "running";

  const [liveElapsed, setLiveElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!isActive || !agent.started_at) {
      setLiveElapsed(null);
      return;
    }
    const tick = () => {
      try {
        const start = new Date(agent.started_at!).getTime();
        const now = Date.now();
        if (!isNaN(start)) {
          setLiveElapsed(Math.max(0, now - start));
        }
      } catch {
        // ignore
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isActive, agent.started_at]);

  const displayElapsed = agent.elapsed_ms ?? liveElapsed;

  return (
    <div
      className={`relative flex gap-3 p-3 rounded-lg transition-colors ${
        isActive
          ? "bg-gray-800/60 border border-blue-500/20"
          : isMuted
            ? "opacity-60"
            : "border border-transparent"
      }`}
    >
      <div className="flex flex-col items-center pt-0.5 gap-1 relative z-10">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center ${
            agent.status === "completed"
              ? "bg-green-500/10"
              : agent.status === "failed"
                ? "bg-red-500/10"
                : isActive
                  ? "bg-blue-500/10"
                  : "bg-gray-800"
          }`}
        >
          <RoleIcon
            size={16}
            className={
              agent.status === "completed"
                ? "text-green-400"
                : agent.status === "failed"
                  ? "text-red-400"
                  : isActive
                    ? "text-blue-400"
                    : "text-gray-500"
            }
          />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-gray-200">{agent.label}</span>
          <StatusIcon status={agent.status} />
        </div>

        <p className={`text-xs ${isMuted ? "text-gray-600" : "text-gray-400"}`}>
          {agent.summary}
        </p>

        {latestLog && agent.status === "running" && (
          <p className="text-[11px] text-gray-500 mt-1">{latestLog}</p>
        )}
        {!latestLog && agent.progress_text && agent.status === "running" && (
          <p className="text-[11px] text-gray-500 mt-1">{agent.progress_text}</p>
        )}

        {displayElapsed != null && (
          <p className="text-[10px] text-gray-600 mt-1 font-mono">
            {formatElapsed(displayElapsed)}
          </p>
        )}

        {agent.history.length > 0 && (
          <AgentStepMiniHistory items={agent.history} />
        )}
      </div>
    </div>
  );
}
