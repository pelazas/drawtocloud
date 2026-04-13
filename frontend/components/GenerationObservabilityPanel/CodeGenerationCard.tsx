"use client";

import { FileCode, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import type { TerraformProgress } from "@/components/TerraformViewer";

type Props = {
  progress: TerraformProgress;
};

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function CodeGenerationCard({ progress }: Props) {
  const isRunning =
    progress.status === "requesting" ||
    progress.status === "planning" ||
    progress.status === "generating" ||
    progress.status === "finalizing";

  const isComplete = progress.status === "completed";
  const isFailed = progress.status === "failed";

  return (
    <div
      className={`relative flex gap-3 p-3 rounded-lg border ${
        isRunning
          ? "bg-gray-800/60 border-blue-500/20"
          : isFailed
            ? "bg-gray-800/40 border-red-500/20"
            : isComplete
              ? "bg-gray-800/20 border-green-500/20"
              : "border-transparent"
      }`}
    >
      <div className="flex flex-col items-center pt-0.5 gap-1 relative z-10">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isComplete
              ? "bg-green-500/10"
              : isFailed
                ? "bg-red-500/10"
                : isRunning
                  ? "bg-blue-500/10"
                  : "bg-gray-800"
          }`}
        >
          {isComplete ? (
            <CheckCircle2 size={16} className="text-green-400" />
          ) : isFailed ? (
            <AlertCircle size={16} className="text-red-400" />
          ) : isRunning ? (
            <Loader2 size={16} className="text-blue-400 animate-spin" />
          ) : (
            <FileCode size={16} className="text-gray-500" />
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-gray-200">Code Generation</span>
          {isRunning && <Loader2 size={14} className="text-blue-400 animate-spin" />}
          {isComplete && <CheckCircle2 size={14} className="text-green-400" />}
          {isFailed && <AlertCircle size={14} className="text-red-400" />}
        </div>

        <p className="text-xs text-gray-400">
          {progress.activity ?? "Generating Terraform files..."}
        </p>

        {progress.currentFile && (
          <p className="text-[11px] text-gray-500 mt-1 truncate">
            {progress.currentFile}
          </p>
        )}

        {progress.emittedCount > 0 && (
          <p className="text-[11px] text-gray-500 mt-1">
            {progress.emittedCount} file{progress.emittedCount !== 1 ? "s" : ""} emitted
          </p>
        )}

        {progress.status === "failed" && (
          <p className="text-[10px] text-red-400 mt-1 font-medium">
            Generation failed
          </p>
        )}
      </div>
    </div>
  );
}