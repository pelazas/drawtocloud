"use client";

import { Suspense } from "react";
import Canvas from "@/components/Canvas";
import CostOverlay from "@/components/CostOverlay";
import DescribeAppModal from "@/components/DescribeAppModal";
import ApiKeyModal from "@/components/ApiKeyModal";
import LeftPanel from "@/components/LeftPanel";
import RightPanel from "@/components/RightPanel";
import SaveProjectModal from "@/components/SaveProjectModal";
import TopBar from "@/components/TopBar";
import { canApplyManualLayout } from "@/lib/manualLayoutPolicy";
import { usePageState } from "./usePageState";

function WorkspaceContent() {
  const {
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
  } = usePageState();

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
        hasArchitecture={pipeline.hasArchitecture}
        actionsDisabled={interactionsLocked}
        quotaText={quotaText}
        onSettings={() => { void apiKeyModal.open(); }}
        onSignIn={() => { workspace.requireAuth(); }}
      />
      <SaveProjectModal
        open={Boolean(showSave && saveProject.showModal)}
        saving={saveProject.saving}
        defaultName={saveProject.modalDefaultName}
        isRenaming={Boolean(workspace.currentProject)}
        onSave={saveProject.saveFromModal}
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
          onBudgetRecoveryAction={pipeline.handleBudgetRecoveryAction}
          budgetRecoveryDisabled={interactionsLocked || !pipeline.chatEnabled}
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
            fitViewTrigger={pipeline.fitViewTrigger}
            readOnly={canvasReadOnly}
            canDragNodes={canApplyManualLayout({ readOnly: canvasReadOnly, isGenerating: pipeline.isGenerating })}
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
          generationAgents={pipeline.generationAgents}
          isGenerating={pipeline.isGenerating}
          terraformFiles={pipeline.terraformFiles}
          archDescription={pipeline.archDescription}
          terraformProgress={pipeline.terraformProgress}
          terraformOutdated={pipeline.terraformOutdated}
          onRegenerateTerraform={pipeline.generateTerraform}
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
