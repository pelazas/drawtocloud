"use client";

import { Suspense } from "react";
import { toast } from "sonner";
import Canvas from "@/components/Canvas";
import CostOverlay from "@/components/CostOverlay";
import DescribeAppModal from "@/components/DescribeAppModal";
import ApiKeyModal from "@/components/ApiKeyModal";
import LeftPanel from "@/components/LeftPanel";
import RightPanel from "@/components/RightPanel";
import SaveProjectModal from "@/components/SaveProjectModal";
import TopBar from "@/components/TopBar";
import { useDescribeAppModal } from "@/components/DescribeAppModal/useDescribeAppModal";
import { useApiKeyModal } from "@/components/ApiKeyModal/useApiKeyModal";
import { canApplyManualLayout } from "@/lib/manualLayoutPolicy";
import { getArchitectStatusText, isInteractionLocked } from "@/lib/generationUiState";
import { useProjectDelete } from "@/lib/projectActions";
import type { QuestionnaireAnswers } from "@/lib/projects";
import { fetchTemplateDetail } from "@/lib/templates";
import { useSaveProject } from "@/lib/useSaveProject";
import { useWorkspace } from "@/lib/useWorkspace";

function WorkspaceContent() {
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
    if (
      pipeline.terraformProgress.status === "requesting" ||
      pipeline.terraformProgress.status === "planning" ||
      pipeline.terraformProgress.status === "generating" ||
      pipeline.terraformProgress.status === "finalizing"
    ) {
      return "generating";
    }
    if (pipeline.terraformFiles.length > 0) {
      return "view";
    }
    return "generate";
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
  });
  const hasArchitecture = pipeline.hasArchitecture;

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
      if (canvasReadOnly) {
        toast.message("Auto Layout is disabled in read-only mode.");
        return;
      }
      toast.message("Wait for generation to finish before auto layout.");
      return;
    }

    pipeline.applyLayout();
  }

  function handleOpenProject(slug: string) {
    if (interactionsLocked) return;
    workspace.openProject(slug);
    workspace.closeRightPanel();
  }

  if (workspace.projectLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-300 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          Loading project...
        </div>
      </div>
    );
  }

  if (workspace.projectNotFound) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-300 flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <p>Project not found.</p>
          <button
            type="button"
            onClick={workspace.clearProject}
            className="inline-flex items-center rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 transition-colors"
          >
            Back to workspace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#02040c]">
      <DescribeAppModal {...describeModal} onSubmit={handleDescribeSubmit} isSubmitting={interactionsLocked} />
      <ApiKeyModal {...apiKeyModal} />
      <TopBar
        user={workspace.user}
        onDescribeApp={handleDescribeApp}
        onTemplates={handleTemplates}
        onMyDesigns={workspace.openMyDesigns}
        onAutoLayout={handleAutoLayout}
        onSave={showSave ? saveProject.handleSaveClick : undefined}
        saveDisabled={!saveProject.canSave || workspace.creatingProject || workspace.projectLoading}
        saving={saveProject.saving}
        onGenerateTerraform={handleGenerateTerraform}
        onSeeTerraformCode={handleSeeTerraformCode}
        terraformButtonState={terraformButtonState}
        hasArchitecture={hasArchitecture}
        actionsDisabled={interactionsLocked}
        quotaText={quotaText}
        onSettings={() => {
          void apiKeyModal.open();
        }}
        onSignIn={() => {
          workspace.requireAuth();
        }}
      />
      <SaveProjectModal
        open={Boolean(showSave && saveProject.showModal)}
        saving={saveProject.saving}
        defaultName={saveProject.modalDefaultName}
        isRenaming={Boolean(workspace.currentProject)}
        onSave={saveProject.saveNew}
        onClose={saveProject.closeModal}
      />

      <div className="flex flex-1 overflow-hidden">
        <LeftPanel
          user={workspace.user}
          messages={pipeline.messages}
          onSend={pipeline.handleSend}
          disabled={interactionsLocked || !pipeline.chatEnabled}
          isTyping={pipeline.isChatStreaming}
          disabledReason={chatDisabledReason}
          onAcceptAndGenerate={pipeline.handleApprovePlan}
          approveDisabled={approveDisabled || interactionsLocked}
          selectedNodes={pipeline.selectedNodes}
          onDeselectNode={pipeline.deselectNode}
        />

        <div className="flex-1 relative overflow-hidden">
          <Canvas
            nodes={pipeline.nodes}
            edges={pipeline.edges}
            selectedNodeIds={pipeline.selectedNodeIds}
            onNodesChange={pipeline.onNodesChange}
            onEdgesChange={pipeline.onEdgesChange}
            onDeleteNodes={pipeline.handleDeleteNodes}
            fitViewTrigger={pipeline.fitViewTrigger}
            readOnly={canvasReadOnly}
            statusText={architectStatus}
          >
            <CostOverlay costEstimate={pipeline.costEstimate} />
          </Canvas>

          {!workspace.currentProject && workspace.creatingProject && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-gray-400 text-sm bg-gray-950/85 rounded-lg px-4 py-3 border border-gray-800">
                Creating project...
              </div>
            </div>
          )}
        </div>

        <RightPanel
          open={workspace.rightPanelOpen}
          tab={workspace.rightPanelTab}
          onClose={workspace.closeRightPanel}
          terraformFiles={pipeline.terraformFiles}
          archDescription={pipeline.archDescription}
          isGenerating={pipeline.isGenerating}
          terraformProgress={pipeline.terraformProgress}
          setupPdfState={pipeline.setupPdfState}
          setupPdfGenerationReady={pipeline.generationCompleted}
          onGenerateSetupPdf={pipeline.requestSetupPdfGeneration}
          onDownloadSetupPdf={pipeline.requestSetupPdfDownload}
          projects={workspace.projectSummaries}
          projectsLoading={workspace.projectsLoading}
          onOpenProject={handleOpenProject}
          onDeleteProject={projectDelete.handleDeleteClick}
          onUseTemplate={handleUseTemplate}
          pendingDeleteId={projectDelete.pendingDeleteId}
          isDeleting={projectDelete.isDeleting}
          onConfirmDelete={projectDelete.confirmDelete}
          onCancelDelete={projectDelete.cancelDelete}
        />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[#02040c]">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      }
    >
      <WorkspaceContent />
    </Suspense>
  );
}
