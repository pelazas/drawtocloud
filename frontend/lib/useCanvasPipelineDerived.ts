import { useMemo } from "react";
import { hasArchitecture } from "./canvasInteractionGuards";
import type { PipelineState } from "./usePipelineState";
import type { DiagramState } from "./useDiagramState";
import type { CanvasSession } from "./projects";

export function useCanvasPipelineDerived({
  readOnly,
  pipeline,
  diagram,
  canvasSession,
}: {
  readOnly: boolean;
  pipeline: PipelineState;
  diagram: DiagramState;
  canvasSession: CanvasSession | null;
}) {
  const activeProjectId = canvasSession?.mode === "existing" ? canvasSession.project.id : canvasSession?.mode === "new" ? canvasSession.projectId ?? null : null;
  const generationCompleted = pipeline.currentStage === "completed" || (canvasSession?.mode === "existing" && canvasSession.project.generationStage === "completed");
  const canvasHasArchitecture = hasArchitecture(diagram.nodes);
  const chatEnabled = !readOnly && !pipeline.isGenerating && !pipeline.isChatStreaming;
  const chatDisabledReason = readOnly ? "Read-only shared view." : !activeProjectId ? null : pipeline.isGenerating ? "Chat unlocks once generation is completed." : pipeline.isChatStreaming ? "Assistant is replying..." : null;
  const displayedMessages = pipeline.streamingAssistantReply
    ? [...pipeline.messages, { role: "assistant" as const, content: pipeline.streamingAssistantReply }]
    : pipeline.messages;
  const selectedNodes = useMemo(() => diagram.selectedNodeIds.map((id) => {
    const node = diagram.canonicalNodes.find((c) => c.id === id);
    return { id, label: typeof node?.data?.label === "string" && node.data.label.length > 0 ? node.data.label : id, category: typeof node?.data?.category === "string" && node.data.category.length > 0 ? node.data.category : "default" };
  }), [diagram.canonicalNodes, diagram.selectedNodeIds]);
  const isManualTerraformRun = pipeline.manualTerraformRunState === "running" || pipeline.manualTerraformRunState === "completed" || pipeline.manualTerraformRunState === "failed";

  return { activeProjectId, generationCompleted, canvasHasArchitecture, chatEnabled, chatDisabledReason, displayedMessages, selectedNodes, isManualTerraformRun };
}
