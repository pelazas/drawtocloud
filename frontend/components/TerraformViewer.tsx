"use client";
import { useState, useEffect } from "react";
import { codeToHtml } from "shiki";
import { Clipboard, ClipboardCheck } from "lucide-react";

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
};

function progressPercent(progress: TerraformProgress | undefined, fileCount: number): number {
  if (!progress) return fileCount > 0 ? 100 : 0;
  if (progress.status === "completed") return 100;
  if (progress.status === "failed") return Math.min(Math.max(progress.emittedCount * 20, 10), 95);

  const expected = Math.max(progress.expectedMinFiles || 4, 1);
  const emitted = Math.max(progress.emittedCount, fileCount);
  const base = Math.round((emitted / expected) * 100);
  return Math.min(Math.max(base, progress.status === "requesting" ? 15 : 8), 95);
}

function progressLabel(progress: TerraformProgress | undefined, isGenerating: boolean, fileCount: number): string {
  if (progress?.activity) return progress.activity;
  if (!isGenerating && fileCount > 0) return "Terraform ready";
  if (isGenerating) return "Generating Terraform...";
  return "Generate an architecture to see Terraform files";
}

export default function TerraformViewer({ files, isGenerating, terraformProgress }: Props) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  useEffect(() => {
    if (!isGenerating) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    if (files.length === 0) {
      setActiveFile(null);
      return;
    }
    if (!activeFile) {
      setActiveFile(files[0].filename);
      return;
    }
    if (!files.some((file) => file.filename === activeFile)) {
      setActiveFile(files[0].filename);
    }
  }, [activeFile, files]);

  useEffect(() => {
    const pending = files.find((file) => !highlighted[file.filename]);
    if (!pending) return;

    void codeToHtml(pending.content, { lang: "hcl", theme: "github-dark-dimmed" }).then((html) =>
      setHighlighted((prev) => ({ ...prev, [pending.filename]: html }))
    );
  }, [files, highlighted]);

  function downloadFile() {
    const file = files.find((f) => f.filename === activeFile);
    if (!file) return;
    const blob = new Blob([file.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard() {
    const file = files.find((f) => f.filename === activeFile);
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Clipboard access denied");
      setTimeout(() => setCopyError(null), 3000);
    }
  }

  const percent = progressPercent(terraformProgress, files.length);
  const label = progressLabel(terraformProgress, isGenerating, files.length);
  const progressDetails = terraformProgress
    ? `${Math.max(terraformProgress.emittedCount, files.length)}/${Math.max(terraformProgress.expectedMinFiles, 1)} files`
    : null;
  const showProgress =
    isGenerating ||
    (terraformProgress &&
      (terraformProgress.status !== "idle" || files.length > 0));
  const delayed =
    isGenerating &&
    !!terraformProgress?.lastUpdateAt &&
    nowMs - terraformProgress.lastUpdateAt > 15_000;

  if (files.length === 0) {
    return (
      <div className="flex-1 flex flex-col text-gray-500 text-sm">
        {showProgress && (
          <div className="px-3 py-3 border-b border-gray-800">
            <div className="flex items-center justify-between text-[11px] text-gray-300">
              <span>{label}</span>
              <span>{percent}%</span>
            </div>
            <div className="mt-2 h-1.5 rounded bg-gray-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  terraformProgress?.status === "failed" ? "bg-red-500" : "bg-blue-500"
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
            {progressDetails && (
              <p className="mt-1 text-[11px] text-gray-400">{progressDetails}</p>
            )}
            {delayed && (
              <p className="mt-2 text-[11px] text-amber-400">
                Still generating. Check Debug for trace and stage details.
              </p>
            )}
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          {isGenerating ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              {label}
            </div>
          ) : (
            "Generate an architecture to see Terraform files"
          )}
        </div>
      </div>
    );
  }

  const activeContent = files.find((f) => f.filename === activeFile);

  return (
    <div className="flex flex-col h-full">
      {showProgress && (
        <div className="px-3 py-2 border-b border-gray-800">
          <div className="flex items-center justify-between text-[11px] text-gray-300">
            <span>{label}</span>
            <span>{percent}%</span>
          </div>
          <div className="mt-2 h-1.5 rounded bg-gray-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                terraformProgress?.status === "failed" ? "bg-red-500" : "bg-blue-500"
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
          {progressDetails && (
            <p className="mt-1 text-[11px] text-gray-400">{progressDetails}</p>
          )}
          {delayed && (
            <p className="mt-1 text-[11px] text-amber-400">
              Still generating. Check Debug for trace and stage details.
            </p>
          )}
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
        <div className="flex-1" />
        {copyError && (
          <span className="text-red-400 text-xs animate-pulse">
            {copyError}
          </span>
        )}
        <button
          onClick={copyToClipboard}
          title={copied ? "Copied ✓" : "Copy to clipboard"}
          className={`transition-colors p-1 rounded ${
            copied ? "text-green-400" : "text-gray-400 hover:text-white"
          }`}
        >
          {copied ? <ClipboardCheck size={13} /> : <Clipboard size={13} />}
        </button>
        <button
          onClick={downloadFile}
          title="Download file"
          className="text-gray-400 hover:text-white transition-colors p-1 rounded"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>

      {/* Code content */}
      <div className="flex-1 overflow-auto">
        {activeContent && highlighted[activeContent.filename] ? (
          <div
            className="text-xs p-4 h-full"
            dangerouslySetInnerHTML={{ __html: highlighted[activeContent.filename] }}
          />
        ) : (
          <pre className="text-xs p-4 text-gray-300 font-mono whitespace-pre-wrap">
            {activeContent?.content}
          </pre>
        )}
      </div>
    </div>
  );
}
