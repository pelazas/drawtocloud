export type GenerationUiInput = {
  isGenerating: boolean;
  creatingProject: boolean;
  isGeneratingTerraform?: boolean;
};

export function isInteractionLocked(input: GenerationUiInput): boolean {
  return input.isGenerating || input.creatingProject;
}

export function getArchitectStatusText(input: GenerationUiInput): string | null {
  if (input.isGeneratingTerraform) return "Coder is generating the Terraform code";
  return input.isGenerating ? "Architect is building the application" : null;
}

export function nextArchitectDotCount(current: number): number {
  return current >= 3 ? 1 : current + 1;
}

export function formatArchitectStatusWithDots(statusText: string, dotCount: number): string {
  return `${statusText}${".".repeat(Math.max(1, Math.min(3, dotCount)))}`;
}
