"use client";

import { toast } from "sonner";
import { useDescribeAppModal } from "@/components/DescribeAppModal/useDescribeAppModal";
import { useApiKeyModal } from "@/components/ApiKeyModal/useApiKeyModal";
import { canApplyManualLayout } from "@/lib/manualLayoutPolicy";
import { getArchitectStatusText, isInteractionLocked } from "@/lib/generationUiState";
import { useProjectDelete } from "@/lib/projectActions";
import type { QuestionnaireAnswers } from "@/lib/projects";
import { fetchTemplateDetail } from "@/lib/templates";
import { useSaveProject } from "@/lib/useSaveProject";
import { useWorkspace } from "@/lib/useWorkspace";

export function usePageState() {
  const workspace = useWorkspace();
  const pipeline = workspace.pipeline;
  const describeModal = useDescribeAppModal();
  const apiKeyModal = useApiKeyModal();

  const projectDelete = useProjectDelete({
    projects: workspace.projects,
    setProjects: workspace.setProjects,
  });
  const saveProject = useSaveProject({
    currentProject: workspace.currentProject,
    isOwner: workspace.isOwner,
    nodes: pipeline.nodes,
    edges: pipeline.edges,
  });
  const showSave = workspace.user && (!workspace.currentProject || workspace.isOwner);
  const approveDisabled =
    !pipeline.pendingArchitecturePlanId || pipeline.isGenerating || !pipeline.chatEnabled;
  const canvasReadOnly = workspace.currentProject ? !workspace.isOwner : !workspace.user;

  const terraformButtonState: "generate" | "generating" | "view" = (() => {
    const s = pipeline.terraformProgress.status;
    if (s === "requesting" || s === "planning" || s === "generating" || s === "finalizing") {
      return "generating";
    }
    return pipeline.terraformFiles.length > 0 ? "view" : "generate";
  })();

  const interactionsLocked = isInteractionLocked({
    isGenerating: pipeline.isGenerating,
    creatingProject: workspace.creatingProject,
  });
  const architectStatus = getArchitectStatusText({
    isGenerating: pipeline.isGenerating,
    creatingProject: workspace.creatingProject,
    isGeneratingTerraform: terraformButtonState === "generating",
    isChatStreaming: pipeline.isChatStreaming,
    pipelineStatus: pipeline.pipelineStatus,
    pipelineErrorCode: pipeline.pipelineErrorCode,
  });

  const chatDisabledReason = !workspace.user
    ? "Sign in to start designing"
    : interactionsLocked
      ? architectStatus
      : workspace.creatingProject
        ? "Preparing your workspace..."
        : pipeline.chatDisabledReason;

  const quotaText = workspace.user
    ? workspace.quotaLoading
      ? "... / ... generations left"
      : workspace.hasApiKey
        ? "Unlimited generations"
        : `${workspace.remainingGenerations} / ${workspace.generationsLimit} generations left`
    : null;

  function handleDescribeApp() {
    if (interactionsLocked) return;
    if (!workspace.requireAuth()) return;
    describeModal.open();
  }

  function handleDescribeSubmit(answers: QuestionnaireAnswers) {
    if (interactionsLocked) return;
    if (workspace.currentProject) {
      void pipeline.startGenerationFromAnswers(answers, { forceNewProject: true });
    } else {
      void workspace.startWithDescription(answers);
    }
  }

  function handleGenerateTerraform() {
    if (interactionsLocked) return;
    if (!workspace.requireAuth()) return;
    if (!workspace.currentProject) {
      describeModal.open();
      return;
    }
    workspace.openOutput();
    void pipeline.generateTerraform();
  }

  function handleSeeTerraformCode() {
    if (workspace.rightPanelOpen && workspace.rightPanelTab === "output") {
      workspace.closeRightPanel();
    } else {
      workspace.openOutput();
    }
  }

  function handleTemplates() {
    if (interactionsLocked) return;
    workspace.openTemplates();
  }

  async function handleUseTemplate(slug: string) {
    if (interactionsLocked) return;
    if (pipeline.nodes.length > 0) {
      const shouldReplace = window.confirm(
        "Discard current design? Loading this template will replace your current canvas."
      );
      if (!shouldReplace) return;
    }
    try {
      const template = await fetchTemplateDetail(slug);
      pipeline.loadTemplateSnapshot(template);
      toast.success(`Loaded template: ${template.title}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load template");
    }
  }

  function handleAutoLayout() {
    if (interactionsLocked) return;
    if (!canApplyManualLayout({ readOnly: canvasReadOnly, isGenerating: pipeline.isGenerating })) {
      toast.message(canvasReadOnly ? "Auto Layout is disabled in read-only mode." : "Wait for generation to finish before auto layout.");
      return;
    }
    pipeline.applyLayout();
    pipeline.scheduleCanvasPersist();
  }

  function handleOpenProject(slug: string) {
    if (interactionsLocked) return;
    workspace.openProject(slug);
    workspace.closeRightPanel();
  }

  return {
    workspace,
    pipeline,
    describeModal,
    apiKeyModal,
    projectDelete,
    saveProject,
    showSave,
    approveDisabled,
    canvasReadOnly,
    terraformButtonState,
    interactionsLocked,
    architectStatus,
    chatDisabledReason,
    quotaText,
    handleDescribeApp,
    handleDescribeSubmit,
    handleGenerateTerraform,
    handleSeeTerraformCode,
    handleTemplates,
    handleUseTemplate,
    handleAutoLayout,
    handleOpenProject,
  };
}
