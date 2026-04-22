import { useEffect, useRef } from "react";
import type { CanvasMessage } from "./projects";
import type { GenerationAgentState } from "./generationObservability";
import type { ConnectionState } from "./websocket";
import type { CanvasPipelineRefs } from "./canvasPipelineRefs";

export function useCanvasPipelineRefs(pipeline: { traceId: string | null; isGenerating: boolean; architectureAgents: GenerationAgentState[] | null }) {
  const refs: CanvasPipelineRefs = {
    generationStartRef: useRef(0), generationStartedAtRef: useRef<number | null>(null),
    isGeneratingRef: useRef(false), activeSessionKeyRef: useRef<string | null>(null),
    generationRequestKeyRef: useRef<string | null>(null), latestCanvasShapeRef: useRef({ nodeCount: 0, edgeCount: 0 }),
    lastHydratedUpdatedAtRef: useRef<string | null>(null), stallWarnedRef: useRef(false),
    pendingTemplateEstimateRequestIdRef: useRef<string | null>(null), pendingTemplateEstimateTimeoutRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    chatResponseTimeoutRef: useRef<ReturnType<typeof setTimeout> | null>(null), templateEstimateRequestSeqRef: useRef(0),
    streamingReplyRef: useRef(""), messagesRef: useRef<CanvasMessage[]>([]),
    architectureAgentsRef: useRef(null), chatProjectBootstrapRef: useRef({ context: null, pending: null }),
    wsStateRef: useRef<ConnectionState>("idle"),
  };

  const traceIdRef = useRef(pipeline.traceId);
  useEffect(() => { traceIdRef.current = pipeline.traceId; }, [pipeline.traceId]);
  useEffect(() => { refs.isGeneratingRef.current = pipeline.isGenerating; }, [pipeline.isGenerating]);
  useEffect(() => { refs.architectureAgentsRef.current = pipeline.architectureAgents; }, [pipeline.architectureAgents]);

  return { refs, traceIdRef };
}
