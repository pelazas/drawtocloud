import { describe, expect, it } from "vitest";
import {
  formatArchitectStatusWithDots,
  getArchitectStatusText,
  nextArchitectDotCount,
  isInteractionLocked,
  type GenerationUiInput,
} from "../generationUiState";

describe("generation UI state", () => {
  it("locks interactions while architect generation is running", () => {
    expect(isInteractionLocked({ isGenerating: true, creatingProject: false })).toBe(true);
  });

  it("locks interactions while creating project for generation", () => {
    expect(isInteractionLocked({ isGenerating: false, creatingProject: true })).toBe(true);
  });

  it("does not lock interactions when idle", () => {
    expect(isInteractionLocked({ isGenerating: false, creatingProject: false })).toBe(false);
  });

  it("shows the architect status text while generation is running", () => {
    expect(getArchitectStatusText({ isGenerating: true, creatingProject: false })).toBe(
      "Architect generating app"
    );
  });

  it("hides architect status text when only creating project", () => {
    expect(getArchitectStatusText({ isGenerating: false, creatingProject: true })).toBeNull();
  });

  it("hides the architect status text while idle", () => {
    expect(getArchitectStatusText({ isGenerating: false, creatingProject: false })).toBeNull();
  });

  it("shows coder status text while terraform is being generated", () => {
    expect(
      getArchitectStatusText({ isGenerating: false, creatingProject: false, isGeneratingTerraform: true })
    ).toBe("Coder is generating the Terraform code");
  });

  it("coder status takes priority over architect status during terraform generation", () => {
    expect(
      getArchitectStatusText({ isGenerating: true, creatingProject: false, isGeneratingTerraform: true })
    ).toBe("Coder is generating the Terraform code");
  });

  it("coder status takes priority over project creation during terraform generation", () => {
    expect(
      getArchitectStatusText({ isGenerating: false, creatingProject: true, isGeneratingTerraform: true })
    ).toBe("Coder is generating the Terraform code");
  });

  it("shows assistant status while chat reply is streaming", () => {
    expect(
      getArchitectStatusText({ isGenerating: false, creatingProject: false, isChatStreaming: true })
    ).toBe("Assistant is thinking");
  });

  it("shows a generic failure status when pipeline reports an error", () => {
    expect(
      getArchitectStatusText({
        isGenerating: false,
        creatingProject: false,
        pipelineStatus: "Error: column thumbnail_url does not exist",
      })
    ).toBe("Generation failed. Try again later");
  });

  it("shows budget-specific guidance for budget cap failures", () => {
    expect(
      getArchitectStatusText({
        isGenerating: false,
        creatingProject: false,
        pipelineStatus: "Error: Budget hard cap unmet",
        pipelineErrorCode: "budget_cap_unmet",
      } satisfies GenerationUiInput)
    ).toBe("Over budget. Use Retry or Accept in chat");
  });

  it("shows rate-limit guidance for provider throttling failures", () => {
    expect(
      getArchitectStatusText({
        isGenerating: false,
        creatingProject: false,
        pipelineStatus: "Error: The AI provider is temporarily rate-limited",
        pipelineErrorCode: "llm_rate_limited",
      } satisfies GenerationUiInput)
    ).toBe("AI provider is busy. Retry in a moment");
  });

  it("keeps generation status priority over generic pipeline error", () => {
    expect(
      getArchitectStatusText({
        isGenerating: true,
        creatingProject: false,
        pipelineStatus: "Error: backend failed",
      })
    ).toBe("Architect generating app");
  });

  it("formats status text with 1-3 animated dots", () => {
    expect(formatArchitectStatusWithDots("Architect generating app", 1)).toBe(
      "Architect generating app."
    );
    expect(formatArchitectStatusWithDots("Architect generating app", 2)).toBe(
      "Architect generating app.."
    );
    expect(formatArchitectStatusWithDots("Architect generating app", 3)).toBe(
      "Architect generating app..."
    );
  });

  it("cycles dot count from 1 to 3", () => {
    expect(nextArchitectDotCount(1)).toBe(2);
    expect(nextArchitectDotCount(2)).toBe(3);
    expect(nextArchitectDotCount(3)).toBe(1);
  });
});
