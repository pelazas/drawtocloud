import { useCallback, useEffect, useRef } from "react";
import { saveSnapshot } from "./projectApi";
import type { DiagramState } from "./useDiagramState";
import type { DebugEvent } from "./useCanvasPipeline";
import type { SetupPdfState } from "./setupPdf";

export function useCanvasPersist({
  activeProjectId,
  readOnly,
  currentStage,
  traceId,
  pushDebugEvent,
  setTerraformOutdated,
  setSetupPdfState,
  diagram,
}: {
  activeProjectId: string | null;
  readOnly: boolean;
  currentStage: string | null;
  traceId: string | null;
  pushDebugEvent: (event: Omit<DebugEvent, "id">) => void;
  setTerraformOutdated: (value: boolean) => void;
  setSetupPdfState: React.Dispatch<React.SetStateAction<SetupPdfState>>;
  diagram: Pick<DiagramState, "canonicalNodes" | "edges">;
}) {
  const latestGraphRef = useRef({ nodes: diagram.canonicalNodes, edges: diagram.edges });
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestGraphRef.current = { nodes: diagram.canonicalNodes, edges: diagram.edges };
  }, [diagram.edges, diagram.canonicalNodes]);

  useEffect(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  }, [activeProjectId]);

  useEffect(
    () => () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    },
    []
  );

  const scheduleCanvasPersist = useCallback(
    (options?: { structureChanged?: boolean }) => {
      if (!activeProjectId || readOnly) return;
      const structureChanged = options?.structureChanged ?? true;
      if (structureChanged) {
        setTerraformOutdated(true);
        setSetupPdfState((prev) =>
          prev.status === "ready" || prev.status === "outdated"
            ? { ...prev, status: "outdated" }
            : prev
        );
      }
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }

      const projectId = activeProjectId;
      const snapshot = latestGraphRef.current;

      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void saveSnapshot(projectId, snapshot.nodes, snapshot.edges, { structureChanged }).catch((error) => {
          pushDebugEvent({
            ts: Date.now(),
            level: "warning",
            source: "local",
            stage: currentStage,
            message: `Failed to persist canvas snapshot: ${error instanceof Error ? error.message : "Unknown error"}`,
            traceId,
          });
        });
      }, 300);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeProjectId, currentStage, pushDebugEvent, readOnly, traceId]
  );

  return { scheduleCanvasPersist, persistTimerRef, latestGraphRef };
}
