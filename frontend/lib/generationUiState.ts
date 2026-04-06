export type GenerationUiInput = {
  isGenerating: boolean;
  creatingProject: boolean;
  isGeneratingTerraform?: boolean;
  isChatStreaming?: boolean;
  pipelineStatus?: string | null;
};

export function isInteractionLocked(input: GenerationUiInput): boolean {
  return input.isGenerating || input.creatingProject;
}

export function getArchitectStatusText(input: GenerationUiInput): string | null {
  if (input.isGenerating) return "Architect generating app";
  if (input.isGeneratingTerraform) return "Coder is generating the Terraform code";
  if (input.isChatStreaming) return "Assistant is thinking";
  if (typeof input.pipelineStatus === "string" && input.pipelineStatus.trim().toLowerCase().startsWith("error:")) {
    return "Generation failed. Try again later";
  }
  return null;
}

export function nextArchitectDotCount(current: number): number {
  return current >= 3 ? 1 : current + 1;
}

export function formatArchitectStatusWithDots(statusText: string, dotCount: number): string {
  return `${statusText}${".".repeat(Math.max(1, Math.min(3, dotCount)))}`;
}
