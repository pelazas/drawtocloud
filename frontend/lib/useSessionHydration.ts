import { useRef } from "react";
import type { PipelineState } from "./usePipelineState";
import type { DiagramState } from "./useDiagramState";
import type { CanvasSession } from "./projects";
import type { ConnectionState } from "./websocket";
import { useReadOnlyHydration } from "./useReadOnlyHydration";
import { useNewProjectHydration } from "./useNewProjectHydration";
import { useExistingProjectHydration } from "./useExistingProjectHydration";

export function useSessionHydration({
  appState,
  canvasSession,
  readOnly,
  liveSession,
  wsStateRef,
  traceIdRef,
  pipeline,
  diagram,
  chatActions,
  debugActions,
  queueProjectSubscription,
  onProjectReady,
  generationStartRef,
  generationStartedAtRef,
  stallWarnedRef,
  lastHydratedUpdatedAtRef,
  activeSessionKeyRef,
  generationRequestKeyRef,
  clearPendingTemplateEstimateRequest,
  messagesRef,
}: {
  appState: "dashboard" | "questionnaire" | "canvas";
  canvasSession: CanvasSession | null;
  readOnly: boolean;
  liveSession: boolean;
  wsStateRef: React.MutableRefObject<ConnectionState>;
  traceIdRef: React.MutableRefObject<string | null>;
  pipeline: PipelineState;
  diagram: Pick<DiagramState, "reset" | "hydrate" | "applyLayout">;
  chatActions: { clearChatResponseTimeout: () => void; resetChatStreamingState: () => void };
  debugActions: { pushDebugEvent: (event: Omit<import("./useCanvasPipeline").DebugEvent, "id">) => void; pushTicker: (message: string) => void };
  queueProjectSubscription: (projectId: string | null) => void;
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  generationStartRef: React.MutableRefObject<number>;
  generationStartedAtRef: React.MutableRefObject<number | null>;
  stallWarnedRef: React.MutableRefObject<boolean>;
  lastHydratedUpdatedAtRef: React.MutableRefObject<string | null>;
  activeSessionKeyRef: React.MutableRefObject<string | null>;
  generationRequestKeyRef: React.MutableRefObject<string | null>;
  clearPendingTemplateEstimateRequest: () => void;
  messagesRef: React.MutableRefObject<import("./projects").CanvasMessage[]>;
}) {
  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;

  useReadOnlyHydration({
    appState,
    canvasSession,
    readOnly,
    lastHydratedUpdatedAtRef,
    activeSessionKeyRef,
    pipeline: pipelineRef,
    diagram,
    chatActions,
    clearPendingTemplateEstimateRequest,
  });

  useNewProjectHydration({
    appState,
    canvasSession,
    readOnly,
    activeSessionKeyRef,
    generationStartRef,
    generationStartedAtRef,
    stallWarnedRef,
    generationRequestKeyRef,
    pipeline: pipelineRef,
    diagram,
    chatActions,
    debugActions,
    queueProjectSubscription,
    onProjectReady,
    clearPendingTemplateEstimateRequest,
    messagesRef,
    traceIdRef,
  });

  useExistingProjectHydration({
    appState,
    canvasSession,
    readOnly,
    liveSession,
    wsStateRef,
    lastHydratedUpdatedAtRef,
    activeSessionKeyRef,
    pipeline: pipelineRef,
    diagram,
    chatActions,
    debugActions,
    queueProjectSubscription,
    clearPendingTemplateEstimateRequest,
  });
}
