import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasPipelineRefs } from "@/lib/useCanvasPipelineRefs";
import { useCanvasMessageHandler } from "@/lib/useCanvasMessageHandler";
import { useCanvasPipelineDerived } from "@/lib/useCanvasPipelineDerived";

describe("useCanvasPipelineRefs", () => {
  it("returns refs and traceIdRef", () => {
    const { result } = renderHook(() =>
      useCanvasPipelineRefs({ traceId: "t1", isGenerating: true, architectureAgents: null })
    );
    expect(result.current.refs).toBeDefined();
    expect(result.current.traceIdRef).toBeDefined();
  });
});

describe("useCanvasMessageHandler", () => {
  it("returns handleMessage and subscribeProjectRef", () => {
    const { result } = renderHook(() =>
      useCanvasMessageHandler({
        canvasSession: null,
        pipeline: {} as any,
        diagram: {} as any,
        chatActions: {} as any,
        debugAndConnection: {} as any,
        templateEstimateAndEdit: {} as any,
        refs: {} as any,
      })
    );
    expect(result.current.handleMessage).toBeInstanceOf(Function);
    expect(result.current.subscribeProjectRef).toBeDefined();
  });
});

describe("useCanvasPipelineDerived", () => {
  it("returns derived values", () => {
    const { result } = renderHook(() =>
      useCanvasPipelineDerived({
        readOnly: false,
        pipeline: {
          currentStage: "completed",
          isGenerating: false,
          isChatStreaming: false,
          manualTerraformRunState: "idle",
          messages: [],
          streamingAssistantReply: "",
        } as any,
        diagram: { nodes: [], selectedNodeIds: [], canonicalNodes: [] } as any,
        canvasSession: null,
      })
    );
    expect(result.current.activeProjectId).toBeNull();
    expect(result.current.chatEnabled).toBe(true);
  });
});
