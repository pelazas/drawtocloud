import type { GenerationAgentState } from "./generationObservability";
import type { TerraformProgress } from "@/components/TerraformViewer";

const TERMINAL_CODER_SUMMARY = 'Click on the "SEE TERRAFORM CODE" button in the topbar to see the generated code.';

export interface TerraformGenerationPresentation {
  coderRow: GenerationAgentState | null;
  connectedRowCount: number;
}

export function buildCoderAgentStateFromProgress(
  terraformProgress: TerraformProgress | undefined,
  initialAgents: GenerationAgentState[] | null,
  isManualTerraformRun: boolean = false,
  backendAgents: GenerationAgentState[] | null = null,
): TerraformGenerationPresentation {
  if (!terraformProgress) {
    return { coderRow: null, connectedRowCount: 0 };
  }

  const { status } = terraformProgress;

  const isActive =
    status === "requesting" ||
    status === "planning" ||
    status === "generating" ||
    status === "finalizing";

  const isCompleted = status === "completed";
  const isFailed = status === "failed";
  const isIdle = status === "idle";

  if (isIdle && !isCompleted && !isFailed) {
    return { coderRow: null, connectedRowCount: 0 };
  }

  const initialAgentCount = initialAgents?.length ?? 0;

  if (!isManualTerraformRun) {
    return { coderRow: null, connectedRowCount: initialAgentCount };
  }

  let coderStatus: GenerationAgentState["status"];
  let summary: string;

  if (isCompleted) {
    coderStatus = "completed";
    summary = TERMINAL_CODER_SUMMARY;
  } else if (isFailed) {
    coderStatus = "failed";
    summary = terraformProgress.activity ?? "Terraform generation failed";
  } else if (isActive) {
    coderStatus = "running";
    summary = terraformProgress.activity ?? "Generating Terraform...";
  } else {
    return { coderRow: null, connectedRowCount: initialAgentCount };
  }

  const backendCoder = backendAgents?.find((a) => a.agent === "coder") ?? null;
  const started_at = backendCoder?.started_at ?? (terraformProgress.lastUpdateAt ? new Date(terraformProgress.lastUpdateAt).toISOString() : null);
  const completed_at = isCompleted
    ? (backendCoder?.completed_at ?? (terraformProgress.lastUpdateAt ? new Date(terraformProgress.lastUpdateAt).toISOString() : null))
    : null;

  const coderRow: GenerationAgentState = {
    agent: "coder",
    label: "Coder",
    status: coderStatus,
    summary,
    detail: null,
    blocked_by: [],
    started_at,
    completed_at,
    elapsed_ms: backendCoder?.elapsed_ms ?? null,
    progress_text: isActive ? (terraformProgress.activity ?? null) : null,
    history: backendCoder?.history ?? [],
    error: isFailed ? (terraformProgress.activity ?? null) : null,
  };

  return {
    coderRow,
    connectedRowCount: initialAgentCount,
  };
}

export { TERMINAL_CODER_SUMMARY };
