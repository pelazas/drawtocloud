"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { AgentLogEntry } from "@/lib/useCanvasPipeline";

type Props = {
  logs: AgentLogEntry[];
  isGenerating: boolean;
  nodeCount: number;
  fileCount: number;
  costTotal: number | null;
  generationElapsed: number;
};

const AGENT_COLORS: Record<AgentLogEntry["agent"], string> = {
  requirements: "text-gray-400",
  architect: "text-blue-400",
  coder: "text-cyan-400",
  cost_analyst: "text-purple-400",
  description: "text-teal-400",
};

const AGENT_LABELS: Record<AgentLogEntry["agent"], string> = {
  requirements: "req",
  architect: "arch",
  coder: "coder",
  cost_analyst: "cost",
  description: "desc",
};

function formatElapsed(s: number): string {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

function LogRow({ entry }: { entry: AgentLogEntry }) {
  return (
    <div className="animate-in fade-in duration-300 flex gap-1.5 items-baseline py-0.5 px-3">
      <span className="text-gray-600 font-mono text-[10px] flex-shrink-0">
        [{formatElapsed(entry.elapsed)}]
      </span>
      <span className={`text-[11px] font-medium flex-shrink-0 ${AGENT_COLORS[entry.agent]}`}>
        {AGENT_LABELS[entry.agent]}
      </span>
      <span className="text-gray-400 text-[11px] truncate">{entry.message}</span>
    </div>
  );
}

export default function AgentActivityFeed({
  logs,
  isGenerating,
  nodeCount,
  fileCount,
  costTotal,
  generationElapsed,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [localLogs, setLocalLogs] = useState<AgentLogEntry[]>(logs);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalLogs(logs);
  }, [logs]);

  useEffect(() => {
    if (!collapsed && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [localLogs, collapsed]);

  if (localLogs.length === 0 && !isGenerating) return null;

  const showSummary = !isGenerating && localLogs.length > 0;

  return (
    <div className="absolute bottom-6 left-6 w-72 z-10 bg-black/30 backdrop-blur-md border border-gray-700/50 shadow-xl rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          {isGenerating && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          )}
          <span className="text-gray-300 text-[11px] font-medium">Activity</span>
        </div>
        <div className="flex items-center gap-1">
          {localLogs.length > 0 && (
            <button
              onClick={() => setLocalLogs([])}
              className="text-gray-600 hover:text-gray-400 transition-colors"
              aria-label="Clear logs"
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-gray-600 hover:text-gray-400 transition-colors"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Log area */}
      {!collapsed && (
        <div className="max-h-56 overflow-y-auto py-1">
          {localLogs.map((entry) => (
            <LogRow key={entry.id} entry={entry} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Done summary */}
      {!collapsed && showSummary && (
        <div className="px-3 py-2 border-t border-gray-700/50 flex flex-wrap gap-1.5">
          <span className="text-[10px] text-gray-400">Done in {generationElapsed.toFixed(0)}s</span>
          <span className="bg-blue-500/20 text-blue-300 text-[10px] px-1.5 rounded-full">
            {nodeCount} nodes
          </span>
          <span className="bg-cyan-500/20 text-cyan-300 text-[10px] px-1.5 rounded-full">
            {fileCount} files
          </span>
          {costTotal != null && (
            <span className="bg-green-500/20 text-green-300 text-[10px] px-1.5 rounded-full">
              ${costTotal.toFixed(0)}/mo
            </span>
          )}
        </div>
      )}
    </div>
  );
}
