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

function progressLabel(progress: TerraformProgress | undefined, isGenerating: boolean, fileCount: number): string {
  if (progress?.activity) return progress.activity;
  if (!isGenerating && fileCount > 0) return "Terraform ready";
  if (isGenerating) return "Generating Terraform...";
  return "Generate an architecture to see Terraform files";
}

export default function TerraformViewer({ files, isGenerating, terraformProgress }: Props) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<Record<string, string>>({});
  const [highlightFailed, setHighlightFailed] = useState<Record<string, boolean>>({});
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
    const activeFilenames = new Set(files.map((file) => file.filename));
    setHighlighted((prev) => {
      const next: Record<string, string> = {};
      for (const [filename, html] of Object.entries(prev)) {
        if (activeFilenames.has(filename)) next[filename] = html;
      }
      return next;
    });
    setHighlightFailed((prev) => {
      const next: Record<string, boolean> = {};
      for (const [filename, failed] of Object.entries(prev)) {
        if (activeFilenames.has(filename)) next[filename] = failed;
      }
      return next;
    });
  }, [files]);

  useEffect(() => {
    const pending = files.find((file) => !highlighted[file.filename]);
    if (!pending || highlightFailed[pending.filename]) return;

    void codeToHtml(pending.content, { lang: "hcl", theme: "github-dark-dimmed" })
      .then((html) => {
        const neutralizedBackground = html
          .replace(/background-color:[^;"]+;?/gi, "background-color: transparent;")
          .replace(/background:[^;"]+;?/gi, "background: transparent;");
        setHighlighted((prev) => ({ ...prev, [pending.filename]: neutralizedBackground }));
      })
      .catch((error) => {
        console.warn(`Shiki highlighting failed for ${pending.filename}; falling back to plain text.`, error);
        setHighlightFailed((prev) => ({ ...prev, [pending.filename]: true }));
      });
  }, [files, highlightFailed, highlighted]);

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

  const label = progressLabel(terraformProgress, isGenerating, files.length);
  const delayed =
    isGenerating &&
    !!terraformProgress?.lastUpdateAt &&
    nowMs - terraformProgress.lastUpdateAt > 15_000;

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
            "Generate an architecture to see Terraform files"
          )}
        </div>
      </div>
    );
  }

  const activeContent = files.find((f) => f.filename === activeFile);

  return (
    <div className="flex flex-col h-full min-h-0">
      {delayed && (
        <div className="px-3 py-2 border-b border-gray-800 text-[11px] text-amber-400">
          Still generating. Check Debug for trace and stage details.
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
        {activeContent && highlighted[activeContent.filename] ? (
          <div
            className="text-xs p-4 min-w-max"
            dangerouslySetInnerHTML={{ __html: highlighted[activeContent.filename] }}
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
