import { describe, expect, it, vi, beforeEach } from "vitest";
import { handlePipelineMessage, type PipelineMessageHandlerDeps } from "../pipelineMessageHandler";
import type { TerraformFile } from "@/components/OutputPanel";
import type { CanvasMessage, CostBreakdown } from "@/lib/projects";
import type { DebugEvent } from "../useCanvasPipeline";
import type { GenerationAgentState } from "../generationObservability";
import type { BudgetRetryState } from "../budgetRetry";
import type { SetupPdfState } from "../setupPdf";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

function createMockDeps(overrides?: Partial<PipelineMessageHandlerDeps>): PipelineMessageHandlerDeps {
  return {
    targetProjectId: "proj-123",
    currentStage: null,
    traceId: null,
    terraformFiles: [],
    manualTerraformRunState: "idle",
    isGeneratingRef: { current: false },
    latestCanvasShapeRef: { current: { nodeCount: 0, edgeCount: 0 } },
    streamingReplyRef: { current: "" },
    messagesRef: { current: [] },
    architectureAgentsRef: { current: null },
    pendingTemplateEstimateRequestIdRef: { current: null },
    generationStartRef: { current: 0 },
    generationStartedAtRef: { current: null },
    stallWarnedRef: { current: false },
    setTraceId: vi.fn(),
    setIsGenerating: vi.fn(),
    setPipelineStatus: vi.fn(),
    setPipelineErrorCode: vi.fn(),
    setTerraformFiles: vi.fn(),
    setArchDescription: vi.fn(),
    setCostEstimate: vi.fn(),
    setIsChatStreaming: vi.fn(),
    setStreamingAssistantReply: vi.fn(),
    setAgentLogs: vi.fn(),
    setGenerationAgents: vi.fn(),
    setArchitectureAgents: vi.fn(),
    setGenerationElapsed: vi.fn(),
    setGenerationStartedAt: vi.fn(),
    setCurrentStage: vi.fn(),
    setLastEventAt: vi.fn(),
    setBudgetRetryState: vi.fn(),
    setSetupPdfState: vi.fn(),
    setTerraformOutdated: vi.fn(),
    setTerraformProgress: vi.fn(),
    setManualTerraformRunState: vi.fn(),
    setMessages: vi.fn(),
    setPendingChatPlanId: vi.fn(),
    pushDebugEvent: vi.fn(),
    pushTicker: vi.fn(),
    hydrate: vi.fn(),
    applyLayout: vi.fn(),
    applyGraphMutation: vi.fn(() => ({ ok: true })),
    handleDiagramEvent: vi.fn(),
    reset: vi.fn(),
    clearChatResponseTimeout: vi.fn(),
    resetChatStreamingState: vi.fn(),
    armChatResponseTimeout: vi.fn(),
    failChatRequest: vi.fn(),
    clearPendingTemplateEstimateRequest: vi.fn(),
    subscribeProject: vi.fn(),
    onProjectReady: vi.fn(),
    onGenerationComplete: vi.fn(),
    ...overrides,
  };
}

describe("handlePipelineMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters messages by project_id", () => {
    const deps = createMockDeps({ targetProjectId: "proj-123" });
    handlePipelineMessage({ type: "status", project_id: "other-project", message: "hello" }, deps);
    expect(deps.setPipelineStatus).not.toHaveBeenCalled();
  });

  it("allows messages with matching project_id", () => {
    const deps = createMockDeps({ targetProjectId: "proj-123" });
    handlePipelineMessage({ type: "status", project_id: "proj-123", message: "hello" }, deps);
    expect(deps.setPipelineStatus).toHaveBeenCalledWith("hello");
  });

  it("allows messages with no project_id when targetProjectId is set", () => {
    const deps = createMockDeps({ targetProjectId: "proj-123" });
    handlePipelineMessage({ type: "status", message: "hello" }, deps);
    expect(deps.setPipelineStatus).toHaveBeenCalledWith("hello");
  });

  it("sets trace_id from incoming message", () => {
    const deps = createMockDeps();
    handlePipelineMessage({ type: "status", trace_id: "trace-abc", message: "hello" }, deps);
    expect(deps.setTraceId).toHaveBeenCalledWith("trace-abc");
  });

  describe("generation_started", () => {
    it("resets generation state and sets queued status", () => {
      const deps = createMockDeps();
      handlePipelineMessage({ type: "generation_started" }, deps);
      expect(deps.setIsGenerating).toHaveBeenCalledWith(true);
      expect(deps.setPipelineStatus).toHaveBeenCalledWith("Generation queued...");
      expect(deps.setCurrentStage).toHaveBeenCalledWith("queued");
      expect(deps.setGenerationAgents).toHaveBeenCalledWith(null);
      expect(deps.setGenerationElapsed).toHaveBeenCalledWith(0);
      expect(deps.setGenerationStartedAt).toHaveBeenCalledWith(null);
      expect(deps.pushTicker).toHaveBeenCalledWith("queued");
      expect(deps.setTerraformProgress).toHaveBeenCalledWith(expect.any(Function));
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });
  });

  describe("pipeline_event", () => {
    it("updates stage and pushes debug event", () => {
      const deps = createMockDeps();
      handlePipelineMessage(
        { type: "pipeline_event", stage: "coder", event: "coder.started", message: "Coder started", level: "info" },
        deps
      );
      expect(deps.setCurrentStage).toHaveBeenCalledWith("coder");
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
      expect(deps.pushTicker).toHaveBeenCalledWith("coder:coder.started");
      expect(deps.pushDebugEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "pipeline",
          stage: "coder",
          message: "Coder started",
        })
      );
    });

    it("updates terraform progress on coder events", () => {
      const deps = createMockDeps();
      handlePipelineMessage(
        {
          type: "pipeline_event",
          stage: "coder",
          event: "coder.first_file_emitted",
          message: "Emitting file",
          level: "info",
          details: { emitted_count: 2, expected_min_files: 4, current_file: "main.tf", activity: "Generating main.tf" },
        },
        deps
      );
      expect(deps.setTerraformProgress).toHaveBeenCalledWith(expect.any(Function));
    });

    it("applies layout on specific pipeline events", () => {
      const deps = createMockDeps();
      handlePipelineMessage(
        { type: "pipeline_event", stage: "architect", event: "completed", message: "Done", level: "info" },
        deps
      );
      expect(deps.applyLayout).toHaveBeenCalled();
    });
  });

  describe("done", () => {
    it("marks generation complete and calls onGenerationComplete", () => {
      const deps = createMockDeps();
      handlePipelineMessage({ type: "done" }, deps);
      expect(deps.setIsGenerating).toHaveBeenCalledWith(false);
      expect(deps.setPipelineStatus).toHaveBeenCalledWith("Architecture ready ✓");
      expect(deps.setPipelineErrorCode).toHaveBeenCalledWith(null);
      expect(deps.pushTicker).toHaveBeenCalledWith("done");
      expect(deps.applyLayout).toHaveBeenCalled();
      expect(deps.onGenerationComplete).toHaveBeenCalled();
    });

    it("sets manual terraform run state to completed when running", () => {
      const deps = createMockDeps({ manualTerraformRunState: "running" });
      handlePipelineMessage({ type: "done" }, deps);
      expect(deps.setManualTerraformRunState).toHaveBeenCalledWith("completed");
    });
  });

  describe("error", () => {
    it("sets error state and calls failChatRequest logic via resets", () => {
      const deps = createMockDeps();
      handlePipelineMessage({ type: "error", message: "Something broke" }, deps);
      expect(deps.clearChatResponseTimeout).toHaveBeenCalled();
      expect(deps.resetChatStreamingState).toHaveBeenCalled();
      expect(deps.setIsGenerating).toHaveBeenCalledWith(false);
      expect(deps.setPipelineStatus).toHaveBeenCalledWith("Error: Something broke");
      expect(deps.setPipelineErrorCode).toHaveBeenCalledWith(null);
      expect(deps.pushTicker).toHaveBeenCalledWith("error");
      expect(deps.setTerraformProgress).toHaveBeenCalledWith(expect.any(Function));
    });

    it("adds budget recovery assistant message for budget_cap_unmet", () => {
      const deps = createMockDeps();
      handlePipelineMessage(
        {
          type: "error",
          error: "budget_cap_unmet",
          message: "Budget hard cap unmet",
          budget_cap: 50,
          estimated_total: 100,
        },
        deps
      );
      expect(deps.setMessages).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe("terraform_file", () => {
    it("upserts terraform file and updates progress", () => {
      const deps = createMockDeps();
      const file: TerraformFile = { filename: "main.tf", content: "resource {}", description: "" };
      handlePipelineMessage({ type: "terraform_file", ...file }, deps);
      expect(deps.pushDebugEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "coder",
          message: "Received terraform_file: main.tf",
        })
      );
      expect(deps.setTerraformFiles).toHaveBeenCalledWith(expect.any(Function));
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });
  });

  describe("cost_estimate", () => {
    it("sets cost estimate when no pending request", () => {
      const deps = createMockDeps();
      const estimate: CostBreakdown = {
        region: "us-east-1",
        monthly_total: 100,
        items: [],
      };
      handlePipelineMessage({ type: "cost_estimate", ...estimate }, deps);
      expect(deps.setCostEstimate).toHaveBeenCalledWith(expect.objectContaining({ region: "us-east-1", monthly_total: 100 }));
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });

    it("ignores cost_estimate with mismatched request_id", () => {
      const deps = createMockDeps({ pendingTemplateEstimateRequestIdRef: { current: "req-abc" } });
      handlePipelineMessage({ type: "cost_estimate", request_id: "req-xyz", region: "us-east-1", monthly_total: 100, items: [] }, deps);
      expect(deps.setCostEstimate).not.toHaveBeenCalled();
    });

    it("accepts cost_estimate with matching request_id and clears pending", () => {
      const deps = createMockDeps({ pendingTemplateEstimateRequestIdRef: { current: "req-abc" } });
      handlePipelineMessage({ type: "cost_estimate", request_id: "req-abc", region: "us-east-1", monthly_total: 100, items: [] }, deps);
      expect(deps.clearPendingTemplateEstimateRequest).toHaveBeenCalled();
      expect(deps.setCostEstimate).toHaveBeenCalledWith(expect.objectContaining({ region: "us-east-1", monthly_total: 100 }));
    });
  });

  describe("chat_reply_done", () => {
    it("adds assistant message and resets streaming state", () => {
      const deps = createMockDeps();
      handlePipelineMessage({ type: "chat_reply_done", message: "Hello user" }, deps);
      expect(deps.clearChatResponseTimeout).toHaveBeenCalled();
      expect(deps.resetChatStreamingState).toHaveBeenCalled();
      expect(deps.setMessages).toHaveBeenCalledWith(expect.any(Function));
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });

    it("handles plan_meta pending state", () => {
      const deps = createMockDeps();
      handlePipelineMessage(
        {
          type: "chat_reply_done",
          message: "Plan ready",
          plan_meta: { plan_id: "plan-1", type: "architecture_refactor", status: "pending" },
        },
        deps
      );
      expect(deps.setPendingChatPlanId).toHaveBeenCalledWith("plan-1");
    });

    it("handles plan_meta approved state and clears terraform", () => {
      const deps = createMockDeps();
      handlePipelineMessage(
        {
          type: "chat_reply_done",
          message: "Done",
          plan_meta: { plan_id: "plan-1", type: "architecture_refactor", status: "approved" },
        },
        deps
      );
      expect(deps.setTerraformFiles).toHaveBeenCalledWith([]);
      expect(deps.setIsGenerating).toHaveBeenCalledWith(false);
      expect(deps.setPipelineStatus).toHaveBeenCalledWith("Architecture updated ✓");
    });
  });

  describe("chat_reply_delta", () => {
    it("appends delta to streaming reply", () => {
      const deps = createMockDeps();
      handlePipelineMessage({ type: "chat_reply_delta", delta: "Hello " }, deps);
      expect(deps.armChatResponseTimeout).toHaveBeenCalled();
      expect(deps.setIsChatStreaming).toHaveBeenCalledWith(true);
      expect(deps.setStreamingAssistantReply).toHaveBeenCalledWith(expect.any(Function));
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });
  });

  describe("generation_agent_update", () => {
    it("updates generation agents", () => {
      const deps = createMockDeps();
      const agents: GenerationAgentState[] = [
        { agent: "requirements", label: "Requirements", status: "running", summary: "", detail: null, blocked_by: [], started_at: null, completed_at: null, elapsed_ms: null, progress_text: null, history: [], error: null },
      ];
      handlePipelineMessage({ type: "generation_agent_update", agents }, deps);
      expect(deps.setGenerationAgents).toHaveBeenCalledWith(expect.any(Array));
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });
  });

  describe("canvas_edit_ack", () => {
    it("removes node from cost estimate on remove_node action", () => {
      const deps = createMockDeps();
      handlePipelineMessage({ type: "canvas_edit_ack", action: "remove_node", node_id: "node-1" }, deps);
      expect(deps.setCostEstimate).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe("diagram_event", () => {
    it("delegates to handleDiagramEvent", () => {
      const deps = createMockDeps();
      const event = { type: "diagram_event", action: "add_node", id: "n1" };
      handlePipelineMessage(event, deps);
      expect(deps.handleDiagramEvent).toHaveBeenCalledWith(event);
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });
  });

  describe("setup_pdf_status", () => {
    it("updates setup pdf state", () => {
      const deps = createMockDeps();
      handlePipelineMessage(
        { type: "setup_pdf_status", setup_pdf_status: "generating", setup_pdf_progress: 50, message: "Generating PDF" },
        deps
      );
      expect(deps.setSetupPdfState).toHaveBeenCalledWith(expect.any(Function));
      expect(deps.setPipelineStatus).toHaveBeenCalledWith("Generating PDF");
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });
  });

  describe("project_ready", () => {
    it("calls onProjectReady with project_id and share_slug", () => {
      const deps = createMockDeps({ targetProjectId: null });
      handlePipelineMessage({ type: "project_ready", project_id: "proj-1", share_slug: "slug-1" }, deps);
      expect(deps.onProjectReady).toHaveBeenCalledWith("proj-1", "slug-1");
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });
  });

  describe("agent_log", () => {
    it("appends agent log entry", () => {
      const deps = createMockDeps();
      handlePipelineMessage(
        { type: "agent_log", agent: "requirements", message: "done", elapsed: 1200 },
        deps
      );
      expect(deps.setAgentLogs).toHaveBeenCalledWith(expect.any(Function));
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });
  });

  describe("status", () => {
    it("sets pipeline status and isGenerating", () => {
      const deps = createMockDeps();
      handlePipelineMessage({ type: "status", message: "Working..." }, deps);
      expect(deps.setPipelineStatus).toHaveBeenCalledWith("Working...");
      expect(deps.setIsGenerating).toHaveBeenCalledWith(true);
      expect(deps.pushTicker).toHaveBeenCalledWith("Working...");
    });
  });

  describe("diagram_reset", () => {
    it("resets diagram and cost estimate", () => {
      const deps = createMockDeps();
      handlePipelineMessage({ type: "diagram_reset" }, deps);
      expect(deps.reset).toHaveBeenCalled();
      expect(deps.setCostEstimate).toHaveBeenCalledWith(null);
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });
  });

  describe("arch_description", () => {
    it("sets architecture description", () => {
      const deps = createMockDeps();
      const sections = { overview: "ov", key_components: "kc", tradeoffs: "tf", next_steps: "ns" };
      handlePipelineMessage({ type: "arch_description", sections }, deps);
      expect(deps.setArchDescription).toHaveBeenCalledWith(sections);
      expect(deps.setLastEventAt).toHaveBeenCalledWith(expect.any(Number));
    });
  });

  describe("generation_snapshot", () => {
    it("hydrates canvas when allowed", () => {
      const deps = createMockDeps({
        isGeneratingRef: { current: false },
        latestCanvasShapeRef: { current: { nodeCount: 0, edgeCount: 0 } },
      });
      handlePipelineMessage(
        { type: "generation_snapshot", nodes: [{ id: "n1" }], edges: [] },
        deps
      );
      expect(deps.hydrate).toHaveBeenCalled();
    });

    it("skips hydration during active generation with existing nodes", () => {
      const deps = createMockDeps({
        isGeneratingRef: { current: true },
        latestCanvasShapeRef: { current: { nodeCount: 2, edgeCount: 1 } },
      });
      handlePipelineMessage(
        { type: "generation_snapshot", nodes: [{ id: "n1" }], edges: [] },
        deps
      );
      expect(deps.hydrate).not.toHaveBeenCalled();
      expect(deps.pushDebugEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Skipped generation_snapshot canvas hydration during active generation",
        })
      );
    });
  });

  describe("chat_reply", () => {
    it("adds assistant message directly", () => {
      const deps = createMockDeps();
      handlePipelineMessage({ type: "chat_reply", message: "Direct reply", plan_ready: false }, deps);
      expect(deps.clearChatResponseTimeout).toHaveBeenCalled();
      expect(deps.resetChatStreamingState).toHaveBeenCalled();
      expect(deps.setMessages).toHaveBeenCalledWith(expect.any(Function));
      expect(deps.setPipelineStatus).toHaveBeenCalledWith(expect.any(Function));
    });
  });
});
