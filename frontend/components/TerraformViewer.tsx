"use client";
import { Clipboard, ClipboardCheck } from "lucide-react";

import { useTerraformViewer } from "./useTerraformViewer";

export type TerraformFile = {
  filename: string;
  content: string;
  description: string;
};

export type TerraformProgress = {
  status: "idle" | "planning" | "requesting" | "generating" | "finalizing" | "completed" | "failed";
  activity: string | null;
  emittedCount: number;
  expectedMinFiles: number;
  currentFile: string | null;
  lastUpdateAt: number | null;
};

type Props = {
  files: TerraformFile[];
  isGenerating: boolean;
  terraformProgress?: TerraformProgress;
  isOutdated?: boolean;
  onRegenerate?: () => void;
};

function progressLabel(progress: TerraformProgress | undefined, isGenerating: boolean, fileCount: number): string {
  if (progress?.activity) return progress.activity;
  if (!isGenerating && fileCount > 0) return "Terraform ready";
  if (isGenerating) return "Generating Terraform...";
  return "Generate an architecture to see Terraform files";
}

export default function TerraformViewer({ files, isGenerating, terraformProgress, isOutdated, onRegenerate }: Props) {
  const { activeContent, activeFile, copied, copyError, delayed, downloadFile, highlightedHtml, setActiveFile, copyToClipboard } =
    useTerraformViewer({ files, isGenerating, terraformProgress });

  const label = progressLabel(terraformProgress, isGenerating, files.length);

  if (files.length === 0) {
    return (
      <div className="flex-1 flex flex-col text-gray-500 text-sm">
        <div className="flex-1 flex items-center justify-center">
          {isGenerating ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              {label}
            </div>
          ) : (
            label
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {delayed && (
        <div className="px-3 py-2 border-b border-gray-800 text-[11px] text-amber-400">
          Still generating. Check Debug for trace and stage details.
        </div>
      )}

      {isOutdated && files.length > 0 && (
        <div className="px-3 py-2 border-b border-amber-600/40 bg-amber-500/10">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-200">
              Architecture has changed. Terraform code is outdated.
            </span>
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="px-2 py-1 bg-amber-500/20 border border-amber-500/50 text-amber-100 text-xs rounded hover:bg-amber-500/30"
              >
                Generate Terraform
              </button>
            )}
          </div>
        </div>
      )}

      {/* File tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-700 overflow-x-auto flex-shrink-0">
        {files.map((f) => (
          <button
            key={f.filename}
            onClick={() => setActiveFile(f.filename)}
            className={`px-3 py-1 rounded text-xs font-mono whitespace-nowrap transition-colors ${
              activeFile === f.filename
                ? "bg-gray-900 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {f.filename}
          </button>
        ))}
      </div>

      {/* Code content */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto relative">
        {/* Floating copy/download buttons */}
        <div className="sticky top-2 right-2 float-right flex items-center gap-1 mr-2 mt-2 z-10">
          {copyError && (
            <span className="text-red-400 text-xs animate-pulse mr-1">
              {copyError}
            </span>
          )}
          <button
            onClick={copyToClipboard}
            title={copied ? "Copied ✓" : "Copy to clipboard"}
            className={`transition-colors p-1.5 rounded bg-gray-800/80 backdrop-blur-sm border border-gray-700/50 ${
              copied ? "text-green-400" : "text-gray-400 hover:text-white"
            }`}
          >
            {copied ? <ClipboardCheck size={13} /> : <Clipboard size={13} />}
          </button>
          <button
            onClick={downloadFile}
            title="Download file"
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded bg-gray-800/80 backdrop-blur-sm border border-gray-700/50"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
        {activeContent && highlightedHtml ? (
          <div
            className="text-xs p-4 min-w-max"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre className="text-xs p-4 text-gray-300 font-mono whitespace-pre min-w-max">
            {activeContent?.content}
          </pre>
        )}
      </div>
    </div>
  );
}
