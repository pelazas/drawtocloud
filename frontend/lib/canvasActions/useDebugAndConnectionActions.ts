import { useCallback } from "react";
import wsClient from "@/lib/websocket";
import type { PipelineState } from "../usePipelineState";
import type { CanvasSession } from "../projects";
import type { CanvasPipelineRefs } from "../canvasPipelineRefs";

export function useDebugAndConnectionActions({
  pipeline,
  canvasSession,
  refs,
}: {
  pipeline: Pick<PipelineState, "setStatusTicker" | "setDebugEvents" | "currentStage" | "traceId" | "wsState" | "debugEvents" | "pipelineStatus">;
  canvasSession: CanvasSession | null;
  refs: Pick<CanvasPipelineRefs, "desiredProjectSubscriptionRef" | "stallWarnedRef" | "wsStateRef">;
}) {
  /* eslint-disable react-hooks/exhaustive-deps */
  const pushTicker = useCallback((message: string) => {
    pipeline.setStatusTicker((prev) => [...prev, message].slice(-20));
  }, [pipeline.setStatusTicker]);

  const pushDebugEvent = useCallback((event: Omit<import("../useCanvasPipeline").DebugEvent, "id">) => {
    pipeline.setDebugEvents((prev) => [...prev, { ...event, id: Date.now() + Math.random() }].slice(-200));
  }, [pipeline.setDebugEvents]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const recordDebugEvent = useCallback(
    (
      message: string,
      options?: {
        level?: import("../useCanvasPipeline").DebugEvent["level"];
        stage?: string | null;
        details?: Record<string, unknown>;
      }
    ) => {
      pushDebugEvent({
        ts: Date.now(),
        level: options?.level ?? "info",
        source: "local",
        stage: options?.stage ?? pipeline.currentStage,
        message,
        traceId: pipeline.traceId,
        details: options?.details,
      });
    },
    [pipeline.currentStage, pipeline.traceId, pushDebugEvent]
  );

  const copyDebugReport = useCallback(async () => {
    const latestPollEvent = [...pipeline.debugEvents]
      .reverse()
      .find((event) => typeof event.details?.poll_mode === "string");
    const latestCoderEvent = [...pipeline.debugEvents]
      .reverse()
      .find((event) => event.stage === "coder");

    const lines = [
      `trace_id: ${pipeline.traceId ?? "n/a"}`,
      `ws_state: ${pipeline.wsState}`,
      `current_stage: ${pipeline.currentStage ?? "n/a"}`,
      `status: ${pipeline.pipelineStatus ?? "n/a"}`,
      `poll_mode: ${typeof latestPollEvent?.details?.poll_mode === "string" ? latestPollEvent.details.poll_mode : "n/a"}`,
      `coder_last_milestone: ${latestCoderEvent?.message ?? "n/a"}`,
      `event_count: ${pipeline.debugEvents.length}`,
      "",
      ...pipeline.debugEvents.map((event) => {
        const when = new Date(event.ts).toISOString();
        return `${when} [${event.level}] (${event.source}) stage=${event.stage ?? "n/a"} trace=${event.traceId ?? "n/a"} :: ${event.message}`;
      }),
    ];

    const report = lines.join("\n");
    try {
      await navigator.clipboard.writeText(report);
      pushDebugEvent({
        ts: Date.now(),
        level: "info",
        source: "local",
        stage: pipeline.currentStage,
        message: "Copied debug report to clipboard",
        traceId: pipeline.traceId,
      });
    } catch {
      pushDebugEvent({
        ts: Date.now(),
        level: "warning",
        source: "local",
        stage: pipeline.currentStage,
        message: "Failed to copy debug report",
        traceId: pipeline.traceId,
      });
    }
  }, [pipeline.debugEvents, pipeline.wsState, pipeline.currentStage, pipeline.traceId, pipeline.pipelineStatus, pushDebugEvent]);

  const handleReconnect = useCallback(() => {
    pushDebugEvent({
      ts: Date.now(),
      level: "info",
      source: "local",
      stage: pipeline.currentStage,
      message: "Manual websocket reconnect requested",
      traceId: pipeline.traceId,
    });
    wsClient.reconnect();
  }, [pipeline.currentStage, pipeline.traceId, pushDebugEvent]);

  const recoverFromGenerationStall = useCallback(() => {
    const targetProjectId =
      canvasSession?.mode === "existing"
        ? canvasSession.project.id
        : canvasSession?.projectId ?? null;
    pushDebugEvent({
      ts: Date.now(),
      level: "warning",
      source: "local",
      stage: pipeline.currentStage,
      message: "Stall detected: forcing websocket reconnect",
      traceId: pipeline.traceId,
      details: targetProjectId ? { project_id: targetProjectId } : undefined,
    });
    refs.desiredProjectSubscriptionRef.current = targetProjectId;
    refs.stallWarnedRef.current = false;
    wsClient.reconnect();
  }, [canvasSession, pipeline.currentStage, pipeline.traceId, pushDebugEvent, refs]);

  return { pushTicker, pushDebugEvent, recordDebugEvent, copyDebugReport, handleReconnect, recoverFromGenerationStall };
}
