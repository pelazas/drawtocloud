import type { ConnectionState } from "./websocket";
import type { CanvasMessage } from "./projects";
import type { GenerationAgentState } from "./generationObservability";
import type { ChatProjectBootstrapState } from "./chatProjectContext";

export type CanvasPipelineRefs = {
  generationStartRef: React.MutableRefObject<number>;
  generationStartedAtRef: React.MutableRefObject<number | null>;
  isGeneratingRef: React.MutableRefObject<boolean>;
  activeSessionKeyRef: React.MutableRefObject<string | null>;
  generationRequestKeyRef: React.MutableRefObject<string | null>;
  latestCanvasShapeRef: React.MutableRefObject<{ nodeCount: number; edgeCount: number }>;
  lastHydratedUpdatedAtRef: React.MutableRefObject<string | null>;
  stallWarnedRef: React.MutableRefObject<boolean>;
  pendingTemplateEstimateRequestIdRef: React.MutableRefObject<string | null>;
  pendingTemplateEstimateTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  chatResponseTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  templateEstimateRequestSeqRef: React.MutableRefObject<number>;
  streamingReplyRef: React.MutableRefObject<string>;
  messagesRef: React.MutableRefObject<CanvasMessage[]>;
  architectureAgentsRef: React.MutableRefObject<GenerationAgentState[] | null>;
  chatProjectBootstrapRef: React.MutableRefObject<ChatProjectBootstrapState>;
  wsStateRef: React.MutableRefObject<ConnectionState>;
  desiredProjectSubscriptionRef: React.MutableRefObject<string | null>;
};
