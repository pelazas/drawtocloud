import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePipelineState } from "../usePipelineState";

describe("usePipelineState", () => {
  it("initializes all state to default values", () => {
    const { result } = renderHook(() => usePipelineState());

    expect(result.current.messages).toEqual([]);
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.wsState).toBe("idle");
    expect(result.current.terraformFiles).toEqual([]);
    expect(result.current.costEstimate).toBeNull();
    expect(result.current.pipelineStatus).toBeNull();
    expect(result.current.pendingChatPlanId).toBeNull();
    expect(result.current.isChatStreaming).toBe(false);
    expect(result.current.streamingAssistantReply).toBe("");
    expect(result.current.agentLogs).toEqual([]);
    expect(result.current.generationElapsed).toBe(0);
    expect(result.current.generationStartedAt).toBeNull();
    expect(result.current.currentStage).toBeNull();
    expect(result.current.traceId).toBeNull();
    expect(result.current.lastEventAt).toBeNull();
    expect(result.current.terraformOutdated).toBe(false);
    expect(result.current.manualTerraformRunState).toBe("idle");
  });

  it("provides working setters", () => {
    const { result } = renderHook(() => usePipelineState());

    act(() => {
      result.current.setIsGenerating(true);
    });
    expect(result.current.isGenerating).toBe(true);

    act(() => {
      result.current.setPipelineStatus("Running");
    });
    expect(result.current.pipelineStatus).toBe("Running");
  });
});
