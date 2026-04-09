"use client";

import { useEffect, useMemo, useState } from "react";
import { codeToHtml } from "shiki";

import type { TerraformFile, TerraformProgress } from "./TerraformViewer";
import {
  getPendingHighlightFile,
  syncHighlightCache,
  syncHighlightFailures,
  type HighlightCache,
  type HighlightFailures,
} from "./terraformViewerHighlightCache";

type Params = {
  files: TerraformFile[];
  isGenerating: boolean;
  terraformProgress?: TerraformProgress;
};

export function useTerraformViewer({ files, isGenerating, terraformProgress }: Params) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<HighlightCache>({});
  const [highlightFailed, setHighlightFailed] = useState<HighlightFailures>({});
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
    if (!activeFile || !files.some((file) => file.filename === activeFile)) {
      setActiveFile(files[0].filename);
    }
  }, [activeFile, files]);

  useEffect(() => {
    setHighlighted((prev) => syncHighlightCache(prev, files));
    setHighlightFailed((prev) => syncHighlightFailures(prev, files));
  }, [files]);

  useEffect(() => {
    const pending = getPendingHighlightFile(files, highlighted, highlightFailed);
    if (!pending) return;

    void codeToHtml(pending.content, { lang: "hcl", theme: "github-dark-dimmed" })
      .then((html) => {
        const neutralized = html
          .replace(/background-color:[^;"]+;?/gi, "background-color: transparent;")
          .replace(/background:[^;"]+;?/gi, "background: transparent;");
        setHighlighted((prev) => ({
          ...prev,
          [pending.filename]: { content: pending.content, html: neutralized },
        }));
      })
      .catch((error) => {
        console.warn(`Shiki highlighting failed for ${pending.filename}; falling back to plain text.`, error);
        setHighlightFailed((prev) => ({ ...prev, [pending.filename]: pending.content }));
      });
  }, [files, highlightFailed, highlighted]);

  const activeContent = useMemo(
    () => files.find((file) => file.filename === activeFile) ?? null,
    [activeFile, files]
  );

  async function copyToClipboard() {
    if (!activeContent) return;
    try {
      await navigator.clipboard.writeText(activeContent.content);
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Clipboard access denied");
      setTimeout(() => setCopyError(null), 3000);
    }
  }

  function downloadFile() {
    if (!activeContent) return;
    const blob = new Blob([activeContent.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = activeContent.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return {
    activeContent,
    activeFile,
    copied,
    copyError,
    delayed:
      isGenerating &&
      !!terraformProgress?.lastUpdateAt &&
      nowMs - terraformProgress.lastUpdateAt > 15_000,
    downloadFile,
    highlightedHtml: activeContent ? highlighted[activeContent.filename]?.html ?? null : null,
    setActiveFile,
    copyToClipboard,
  };
}
