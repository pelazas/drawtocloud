import { useEffect } from "react";

const STALL_THRESHOLD_MS = 15_000;

export function useStallRecovery({
  isGenerating,
  lastEventAt,
  currentStage,
  traceId,
  pushDebugEvent,
  pushTicker,
  recoverFromGenerationStall,
  stallWarnedRef,
  setPipelineStatus,
}: {
  isGenerating: boolean;
  lastEventAt: number | null;
  currentStage: string | null;
  traceId: string | null;
  pushDebugEvent: (event: Omit<import("./useCanvasPipeline").DebugEvent, "id">) => void;
  pushTicker: (message: string) => void;
  recoverFromGenerationStall: () => void;
  stallWarnedRef: React.MutableRefObject<boolean>;
  setPipelineStatus: (value: string | null) => void;
}) {
  useEffect(() => {
    if (!isGenerating) return;

    const timer = setInterval(() => {
      if (!lastEventAt) return;
      const age = Date.now() - lastEventAt;
      if (age < STALL_THRESHOLD_MS || stallWarnedRef.current) {
        return;
      }

      stallWarnedRef.current = true;
      setPipelineStatus("Stalled: no events for 15s. Reconnecting websocket...");
      pushTicker("stall-warning");
      pushTicker("stall-recover");
      pushDebugEvent({
        ts: Date.now(),
        level: "warning",
        source: "local",
        stage: currentStage,
        message:
          "No pipeline events for 15s. Triggering websocket reconnect and project re-subscription.",
        traceId,
      });
      recoverFromGenerationStall();
    }, 1000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, lastEventAt, currentStage, traceId, pushDebugEvent, pushTicker, recoverFromGenerationStall]);
}
