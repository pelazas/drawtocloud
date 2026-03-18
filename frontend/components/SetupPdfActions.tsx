"use client";

import { useMemo } from "react";
import { SetupPdfState } from "@/lib/setupPdf";

type Props = {
  state: SetupPdfState;
  canGenerate: boolean;
  onGenerate: () => void;
  onDownload: () => void;
  readOnly?: boolean;
};

function prettyTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export default function SetupPdfActions({
  state,
  canGenerate,
  onGenerate,
  onDownload,
  readOnly = false,
}: Props) {
  const generatedLabel = useMemo(() => prettyTimestamp(state.generatedAt), [state.generatedAt]);

  if (readOnly) return null;

  const progress = Math.max(0, Math.min(100, Math.round(state.progress)));
  const generating = state.status === "generating";
  const failed = state.status === "failed";
  const outdated = state.status === "outdated";
  const ready = state.status === "ready";

  const showDownload = ready || outdated;
  const mainLabel = generating
    ? "Generating setup PDF"
    : failed
      ? "Retry"
      : showDownload
        ? "Download setup PDF"
        : "Generate setup PDF";
  const mainAction = showDownload ? onDownload : onGenerate;
  const mainDisabled = generating || (!showDownload && !canGenerate);

  return (
    <div className="border-t border-gray-800 p-3 space-y-2">
      {outdated && (
        <div className="flex items-center justify-between rounded-md border border-amber-600/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
          <span className="text-amber-200">PDF outdated</span>
          <button
            type="button"
            onClick={onGenerate}
            className="rounded border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 font-medium text-amber-100 hover:bg-amber-500/30"
          >
            Regenerate
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={mainAction}
        disabled={mainDisabled}
        className="w-full rounded-lg border border-blue-600/60 bg-blue-600/20 px-3 py-2 text-xs font-semibold text-blue-100 transition hover:bg-blue-600/30 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
      >
        {mainLabel}
      </button>

      {generating && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[11px] text-gray-400">{progress}%</p>
        </div>
      )}

      {failed && state.error && <p className="text-[11px] text-red-300">{state.error}</p>}
      {generatedLabel && <p className="text-[11px] text-gray-500">Generated: {generatedLabel}</p>}
      {!canGenerate && !showDownload && !generating && (
        <p className="text-[11px] text-gray-500">Available after architecture generation completes.</p>
      )}
    </div>
  );
}
