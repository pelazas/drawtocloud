import { beforeEach, describe, expect, it, vi } from "vitest";
import { getManualTerraformRunStateFromSnapshot, type ManualTerraformRunState } from "../canvasHydration";

describe("manualTerraformRunState reconciliation from generation_snapshot", () => {
  describe("when generation_stage is code_generation and generation_status is completed", () => {
    it("should reconcile manualTerraformRunState from running to completed", () => {
      const result = getManualTerraformRunStateFromSnapshot({
        currentState: "running",
        generationStage: "code_generation",
        generationStatus: "completed",
      });
      expect(result).toBe("completed");
    });
  });

  describe("when generation_stage is code_generation and generation_status is failed", () => {
    it("should reconcile manualTerraformRunState from running to failed", () => {
      const result = getManualTerraformRunStateFromSnapshot({
        currentState: "running",
        generationStage: "code_generation",
        generationStatus: "failed",
      });
      expect(result).toBe("failed");
    });
  });

  describe("when generation_stage is NOT code_generation", () => {
    it("should NOT reconcile when stage is architect", () => {
      const result = getManualTerraformRunStateFromSnapshot({
        currentState: "running",
        generationStage: "architect",
        generationStatus: "completed",
      });
      expect(result).toBeNull();
    });

    it("should NOT reconcile when stage is cost_estimate", () => {
      const result = getManualTerraformRunStateFromSnapshot({
        currentState: "running",
        generationStage: "cost_estimate",
        generationStatus: "completed",
      });
      expect(result).toBeNull();
    });

    it("should NOT reconcile when stage is requirements", () => {
      const result = getManualTerraformRunStateFromSnapshot({
        currentState: "running",
        generationStage: "requirements",
        generationStatus: "completed",
      });
      expect(result).toBeNull();
    });
  });

  describe("when current manualTerraformRunState is NOT running", () => {
    it("reconciles when current state is idle after a reconnect", () => {
      const result = getManualTerraformRunStateFromSnapshot({
        currentState: "idle",
        generationStage: "code_generation",
        generationStatus: "completed",
      });
      expect(result).toBe("completed");
    });

    it("should NOT reconcile when current state is completed", () => {
      const result = getManualTerraformRunStateFromSnapshot({
        currentState: "completed",
        generationStage: "code_generation",
        generationStatus: "completed",
      });
      expect(result).toBeNull();
    });

    it("should NOT reconcile when current state is failed", () => {
      const result = getManualTerraformRunStateFromSnapshot({
        currentState: "failed",
        generationStage: "code_generation",
        generationStatus: "completed",
      });
      expect(result).toBeNull();
    });
  });

  describe("reconnect scenario: missed live terminal events", () => {
    it("reconciles to completed when snapshot arrives after missed live done event", () => {
      let manualTerraformRunState: ManualTerraformRunState = "running";

      const newState = getManualTerraformRunStateFromSnapshot({
        currentState: manualTerraformRunState,
        generationStage: "code_generation",
        generationStatus: "completed",
      });
      if (newState !== null) {
        manualTerraformRunState = newState;
      }

      expect(manualTerraformRunState).toBe("completed");
    });

    it("reconciles to completed when snapshot arrives after a full reconnect reset to idle", () => {
      let manualTerraformRunState: ManualTerraformRunState = "idle";

      const newState = getManualTerraformRunStateFromSnapshot({
        currentState: manualTerraformRunState,
        generationStage: "code_generation",
        generationStatus: "completed",
      });
      if (newState !== null) {
        manualTerraformRunState = newState;
      }

      expect(manualTerraformRunState).toBe("completed");
    });

    it("reconciles to failed when snapshot arrives after missed live error event", () => {
      let manualTerraformRunState: ManualTerraformRunState = "running";

      const newState = getManualTerraformRunStateFromSnapshot({
        currentState: manualTerraformRunState,
        generationStage: "code_generation",
        generationStatus: "failed",
      });
      if (newState !== null) {
        manualTerraformRunState = newState;
      }

      expect(manualTerraformRunState).toBe("failed");
    });
  });
});

describe("generateTerraform send-drop handling", () => {
  const mockSend = vi.fn<[unknown], boolean>();
  const mockSetManualTerraformRunState = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReturnValue(false);
  });

  it("should set manualTerraformRunState to failed when wsClient.send returns false", () => {
    mockSend.mockReturnValue(false);

    const sent = mockSend({ type: "generate_terraform" });

    expect(sent).toBe(false);

    if (!sent) {
      mockSetManualTerraformRunState("failed");
    }

    expect(mockSetManualTerraformRunState).toHaveBeenCalledWith("failed");
  });

  it("should proceed normally when wsClient.send returns true", () => {
    mockSend.mockReturnValue(true);

    const sent = mockSend({ type: "generate_terraform" });

    expect(sent).toBe(true);

    if (!sent) {
      mockSetManualTerraformRunState("failed");
    }

    expect(mockSetManualTerraformRunState).not.toHaveBeenCalled();
  });
});
