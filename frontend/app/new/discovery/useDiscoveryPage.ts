"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCanvasPipeline } from "@/lib/useCanvasPipeline";
import type { CanvasSession } from "@/lib/projects";

const DISCOVERY_DRAFT_STORAGE_KEY = "drawtocloud.discovery.answers.v1";

type DiscoveryAnswers = Record<string, string | string[] | number>;

function isDiscoveryAnswers(value: unknown): value is DiscoveryAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.app_name === "string" && record.app_name.trim().length > 0;
}

export function useDiscoveryPage() {
  const router = useRouter();
  const [answers, setAnswers] = useState<DiscoveryAnswers | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [shareSlug, setShareSlug] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(DISCOVERY_DRAFT_STORAGE_KEY);
    if (!raw) {
      void router.replace("/new");
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!isDiscoveryAnswers(parsed)) throw new Error("Invalid discovery payload.");
      setAnswers(parsed);
    } catch {
      void router.replace("/new");
    }
  }, [router]);

  const canvasSession: CanvasSession | null = useMemo(() => {
    if (!answers) return null;
    return { mode: "chat_first", answers, projectId, shareSlug };
  }, [answers, projectId, shareSlug]);

  const handleProjectReady = useCallback((nextProjectId: string, nextShareSlug: string | null) => {
    setProjectId((prev) => prev ?? nextProjectId);
    if (nextShareSlug) setShareSlug((prev) => prev ?? nextShareSlug);
  }, []);

  const pipeline = useCanvasPipeline("canvas", canvasSession, undefined, handleProjectReady);
  const { triggerGeneration } = pipeline;

  const handleApproveAndGenerate = useCallback(() => {
    void triggerGeneration();
  }, [triggerGeneration]);

  return {
    ready: Boolean(answers && canvasSession),
    shareSlug,
    handleApproveAndGenerate,
    ...pipeline,
  };
}
