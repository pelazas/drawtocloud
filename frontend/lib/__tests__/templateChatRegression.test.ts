import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasPipelineDerived } from "@/lib/useCanvasPipelineDerived";

describe("template-chat regression", () => {
  it("disables chat immediately after template load when websocket is still connecting", () => {
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
          wsState: "connecting",
        } as any,
        diagram: {
          nodes: [
            { id: "vpc", data: { label: "VPC", category: "network" } },
            { id: "alb", data: { label: "Load Balancer", category: "compute" } },
          ],
          selectedNodeIds: [],
          canonicalNodes: [
            { id: "vpc", data: { label: "VPC", category: "network" } },
            { id: "alb", data: { label: "Load Balancer", category: "compute" } },
          ],
        } as any,
        canvasSession: {
          mode: "existing",
          project: {
            id: "proj-template-clone",
            generationStage: "completed",
          },
        } as any,
      })
    );

    expect(result.current.canvasHasArchitecture).toBe(true);
    expect(result.current.chatEnabled).toBe(false);
    expect(result.current.chatDisabledReason).toBe("Reconnecting to live session...");
  });

  it("enables chat once websocket opens after template load", () => {
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
          wsState: "open",
        } as any,
        diagram: {
          nodes: [
            { id: "vpc", data: { label: "VPC", category: "network" } },
            { id: "alb", data: { label: "Load Balancer", category: "compute" } },
          ],
          selectedNodeIds: [],
          canonicalNodes: [
            { id: "vpc", data: { label: "VPC", category: "network" } },
            { id: "alb", data: { label: "Load Balancer", category: "compute" } },
          ],
        } as any,
        canvasSession: {
          mode: "existing",
          project: {
            id: "proj-template-clone",
            generationStage: "completed",
          },
        } as any,
      })
    );

    expect(result.current.canvasHasArchitecture).toBe(true);
    expect(result.current.chatEnabled).toBe(true);
    expect(result.current.chatDisabledReason).toBeNull();
  });
});
