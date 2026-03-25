"use client";

import { Suspense, useMemo } from "react";
import { toast } from "sonner";
import Canvas from "@/components/Canvas";
import CostOverlay from "@/components/CostOverlay";
import LeftPanel from "@/components/LeftPanel";
import RightPanel from "@/components/RightPanel";
import TopBar from "@/components/TopBar";
import { estimateCost } from "@/lib/costEstimator";
import { canApplyManualLayout } from "@/lib/manualLayoutPolicy";
import { useProjectDelete } from "@/lib/projectActions";
import { fetchTemplateDetail } from "@/lib/templates";
import { useWorkspace } from "@/lib/useWorkspace";

function WorkspaceContent() {
  const workspace = useWorkspace();
  const pipeline = workspace.pipeline;
  const costBreakdown = useMemo(() => estimateCost(pipeline.nodes), [pipeline.nodes]);

  const projectDelete = useProjectDelete({
    projects: workspace.projects,
    setProjects: workspace.setProjects,
  });

  const approveDisabled = pipeline.isDiscoveryMode
    ? pipeline.isGenerating || !pipeline.chatEnabled
    : !pipeline.pendingArchitecturePlanId || pipeline.isGenerating || !pipeline.chatEnabled;

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

  const chatDisabledReason = !workspace.user
    ? "Sign in to start designing"
    : workspace.creatingProject
      ? "Preparing your workspace..."
      : pipeline.chatDisabledReason ?? "Click \"Describe your app\" to start.";

  function handleDescribeApp() {
    void workspace.startFromScratch();
  }

  function handleGenerateTerraform() {
    if (!workspace.requireAuth()) return;

    if (!workspace.currentProject) {
      void workspace.startFromScratch();
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
    workspace.openTemplates();
  }

  async function handleUseTemplate(slug: string) {
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
      <TopBar
        user={workspace.user}
        onDescribeApp={handleDescribeApp}
        onTemplates={handleTemplates}
        onMyDesigns={workspace.openMyDesigns}
        onAutoLayout={handleAutoLayout}
        onGenerateTerraform={handleGenerateTerraform}
        onSeeTerraformCode={handleSeeTerraformCode}
        terraformButtonState={terraformButtonState}
        onSignIn={() => {
          workspace.requireAuth();
        }}
      />

      <div className="flex flex-1 overflow-hidden">
        <LeftPanel
          user={workspace.user}
          messages={pipeline.messages}
          onSend={pipeline.handleSend}
          disabled={!pipeline.chatEnabled}
          isTyping={pipeline.isChatStreaming}
          disabledReason={chatDisabledReason}
          onAcceptAndGenerate={pipeline.handleApprovePlan}
          approveDisabled={approveDisabled}
          selectedNodes={pipeline.selectedNodes}
          onDeselectNode={pipeline.deselectNode}
          onStartFromScratch={handleDescribeApp}
          startingFromScratch={workspace.creatingProject}
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
          >
            <CostOverlay monthlyTotal={costBreakdown.monthly_total} />
          </Canvas>

          {!workspace.currentProject && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-gray-400 text-sm bg-gray-950/85 rounded-lg px-4 py-3 border border-gray-800">
                {workspace.user
                  ? workspace.creatingProject
                    ? "Creating project..."
                    : "Click \"Describe your app\" to start."
                  : "Sign in to start designing"}
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
