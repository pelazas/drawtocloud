import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useChatActions,
  useChatSendActions,
  usePlanApprovalActions,
  useDebugAndConnectionActions,
  useSetupPdfActions,
  useGenerationActions,
  useTemplateEstimateAndEditActions,
} from "@/lib/canvasActions";

vi.mock("@/lib/websocket", () => ({
  default: {
    send: vi.fn().mockReturnValue(true),
    reconnect: vi.fn(),
  },
}));

describe("useChatActions", () => {
  it("returns chat action callbacks", () => {
    const setters = {
      setIsChatStreaming: vi.fn(),
      setStreamingAssistantReply: vi.fn(),
      setIsGenerating: vi.fn(),
      setPipelineStatus: vi.fn(),
      setPipelineErrorCode: vi.fn(),
      setLastEventAt: vi.fn(),
    };
    const { result } = renderHook(() =>
      useChatActions({
        ...setters,
        chatResponseTimeoutRef: { current: null },
        streamingReplyRef: { current: "" },
      })
    );
    expect(result.current.clearChatResponseTimeout).toBeInstanceOf(Function);
    expect(result.current.resetChatStreamingState).toBeInstanceOf(Function);
    expect(result.current.failChatRequest).toBeInstanceOf(Function);
    expect(result.current.armChatResponseTimeout).toBeInstanceOf(Function);
  });
});

describe("useTemplateEstimateAndEditActions", () => {
  it("returns template estimate and edit actions", () => {
    const { result } = renderHook(() =>
      useTemplateEstimateAndEditActions({
        setCostEstimate: vi.fn(),
        canvasSession: null,
        pendingTemplateEstimateRequestIdRef: { current: null },
        pendingTemplateEstimateTimeoutRef: { current: null },
        templateEstimateRequestSeqRef: { current: 0 },
      })
    );
    expect(result.current.clearPendingTemplateEstimateRequest).toBeInstanceOf(Function);
    expect(result.current.startPendingTemplateEstimateRequest).toBeInstanceOf(Function);
    expect(result.current.handleDeleteNodes).toBeInstanceOf(Function);
  });
});

describe("useDebugAndConnectionActions", () => {
  it("returns debug and connection actions", () => {
    const pipeline = {
      setStatusTicker: vi.fn(),
      setDebugEvents: vi.fn(),
      currentStage: "start",
      traceId: null,
      wsState: "idle",
      debugEvents: [],
      pipelineStatus: null,
    };
    const { result } = renderHook(() =>
      useDebugAndConnectionActions({
        pipeline: pipeline as any,
        canvasSession: null,
        refs: {
          desiredProjectSubscriptionRef: { current: null },
          stallWarnedRef: { current: false },
          wsStateRef: { current: "idle" },
        } as any,
      })
    );
    expect(result.current.pushTicker).toBeInstanceOf(Function);
    expect(result.current.pushDebugEvent).toBeInstanceOf(Function);
    expect(result.current.recordDebugEvent).toBeInstanceOf(Function);
    expect(result.current.copyDebugReport).toBeInstanceOf(Function);
    expect(result.current.handleReconnect).toBeInstanceOf(Function);
    expect(result.current.recoverFromGenerationStall).toBeInstanceOf(Function);
  });
});

describe("useSetupPdfActions", () => {
  it("returns setup PDF actions", () => {
    const { result } = renderHook(() =>
      useSetupPdfActions({
        activeProjectId: "proj-1",
        generationCompleted: true,
        readOnly: false,
        setSetupPdfState: vi.fn(),
      })
    );
    expect(result.current.requestSetupPdfGeneration).toBeInstanceOf(Function);
    expect(result.current.requestSetupPdfDownload).toBeInstanceOf(Function);
  });
});

describe("useGenerationActions", () => {
  it("returns generation actions", () => {
    const { result } = renderHook(() =>
      useGenerationActions({
        canvasSession: null,
        clearPendingTemplateEstimateRequest: vi.fn(),
        startPendingTemplateEstimateRequest: vi.fn(),
        onProjectReady: vi.fn(),
        queueProjectSubscription: vi.fn(),
        pipeline: {} as any,
        diagram: {} as any,
        refs: {} as any,
        recordDebugEvent: vi.fn(),
        activeProjectId: "proj-1",
        canvasHasArchitecture: true,
      })
    );
    expect(result.current.startGenerationFromAnswers).toBeInstanceOf(Function);
    expect(result.current.loadTemplateSnapshot).toBeInstanceOf(Function);
    expect(result.current.generateTerraform).toBeInstanceOf(Function);
  });
});

describe("useChatSendActions", () => {
  it("returns chat send actions", () => {
    const { result } = renderHook(() =>
      useChatSendActions({
        canvasSession: null,
        chatEnabled: true,
        canvasHasArchitecture: true,
        messages: [],
        diagram: { selectedNodeIds: [], canonicalNodes: [], edges: [] } as any,
        onProjectReady: vi.fn(),
        clearPendingTemplateEstimateRequest: vi.fn(),
        failChatRequest: vi.fn(),
        armChatResponseTimeout: vi.fn(),
        chatProjectBootstrapRef: { current: { context: null, pending: null } },
        setMessages: vi.fn(),
        messagesRef: { current: [] },
        setIsChatStreaming: vi.fn(),
        setStreamingAssistantReply: vi.fn(),
        streamingReplyRef: { current: "" },
        setPipelineStatus: vi.fn(),
        setLastEventAt: vi.fn(),
        setPendingChatPlanId: vi.fn(),
        setIsGenerating: vi.fn(),
        setPipelineErrorCode: vi.fn(),
      })
    );
    expect(result.current.handleSend).toBeInstanceOf(Function);
    expect(result.current.handleBudgetRecoveryAction).toBeInstanceOf(Function);
  });
});

describe("usePlanApprovalActions", () => {
  it("returns plan approval action", () => {
    const { result } = renderHook(() =>
      usePlanApprovalActions({
        chatEnabled: true,
        pendingChatPlanId: null,
        canvasSession: null,
        diagram: { canonicalNodes: [], edges: [] } as any,
        onProjectReady: vi.fn(),
        clearPendingTemplateEstimateRequest: vi.fn(),
        setIsGenerating: vi.fn(),
        setPipelineStatus: vi.fn(),
        setPipelineErrorCode: vi.fn(),
        setCurrentStage: vi.fn(),
        setLastEventAt: vi.fn(),
        messagesRef: { current: [] },
      })
    );
    expect(result.current.handleApprovePlan).toBeInstanceOf(Function);
  });
});
