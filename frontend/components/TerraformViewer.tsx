"use client";
import { useState, useEffect } from "react";
import { codeToHtml } from "shiki";

export type TerraformFile = {
  filename: string;
  content: string;
  description: string;
};

type Props = {
  files: TerraformFile[];
  isGenerating: boolean;
};

export default function TerraformViewer({ files, isGenerating }: Props) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<Record<string, string>>({});

  // Auto-select first file when it arrives
  useEffect(() => {
    if (files.length > 0 && !activeFile) {
      setActiveFile(files[0].filename);
    }
  }, [files.length]);

  // Highlight new files as they arrive
  useEffect(() => {
    const lastFile = files[files.length - 1];
    if (!lastFile || highlighted[lastFile.filename]) return;
    codeToHtml(lastFile.content, { lang: "hcl", theme: "github-dark-dimmed" })
      .then((html) =>
        setHighlighted((prev) => ({ ...prev, [lastFile.filename]: html }))
      );
  }, [files.length]);

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

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        {isGenerating ? (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Generating Terraform...
          </div>
        ) : (
          "Generate an architecture to see Terraform files"
        )}
      </div>
    );
  }

  const activeContent = files.find((f) => f.filename === activeFile);

  return (
    <div className="flex flex-col h-full">
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
