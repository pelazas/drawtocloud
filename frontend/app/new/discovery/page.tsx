"use client";

import Link from "next/link";
import Chat from "@/components/Chat";
import Canvas from "@/components/Canvas";
import OutputPanel from "@/components/OutputPanel";
import AgentActivityFeed from "@/components/AgentActivityFeed";
import { useDiscoveryPage } from "./useDiscoveryPage";

export default function DiscoveryPage() {
  const {
    ready,
    shareSlug,
    nodes,
    edges,
    fitViewTrigger,
    messages,
    pipelineStatus,
    terraformFiles,
    costEstimate,
    archDescription,
    isGenerating,
    agentLogs,
    generationElapsed,
    terraformProgress,
    generationCompleted,
    setupPdfState,
    requestSetupPdfGeneration,
    requestSetupPdfDownload,
    isChatStreaming,
    chatEnabled,
    chatDisabledReason,
    selectedNodeIds,
    selectedNodes,
    deselectNode,
    onNodesChange,
    onEdgesChange,
    handleSend,
    handleDeleteNodes,
    handleApproveAndGenerate,
  } = useDiscoveryPage();

  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-300 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          Preparing discovery interview...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <div className="w-80 flex-shrink-0">
        <Chat
          onSend={handleSend}
          messages={messages}
          disabled={!chatEnabled}
          isTyping={isChatStreaming}
          disabledReason={chatDisabledReason}
          onAcceptAndGenerate={handleApproveAndGenerate}
          approveDisabled={isGenerating}
          selectedNodes={selectedNodes}
          onDeselectNode={deselectNode}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-gray-700 px-4 py-3 flex items-center justify-between gap-3 bg-gray-900">
          <div>
            <h1 className="text-sm font-semibold">Discovery Mode</h1>
            <p className="text-xs text-gray-400">
              {pipelineStatus ?? "Answer a few questions, review the plan, then approve generation."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {shareSlug && (
              <Link
                href={`/p/${shareSlug}`}
                className="inline-flex items-center rounded-lg border border-blue-600/60 bg-blue-600/10 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-600/20 transition-colors"
              >
                Open Saved Project
              </Link>
            )}
            <Link
              href="/new"
              className="inline-flex items-center rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
            >
              Edit Inputs
            </Link>
          </div>
        </div>

        <div className="flex-1 overflow-hidden relative">
          <Canvas
            nodes={nodes}
            edges={edges}
            selectedNodeIds={selectedNodeIds}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onDeleteNodes={handleDeleteNodes}
            fitViewTrigger={fitViewTrigger}
          />
          <AgentActivityFeed
            logs={agentLogs}
            isGenerating={isGenerating}
            nodeCount={nodes.length}
            fileCount={terraformFiles.length}
            costTotal={costEstimate?.monthly_total ?? null}
            generationElapsed={generationElapsed}
          />
        </div>
      </div>

      <OutputPanel
        terraformFiles={terraformFiles}
        costEstimate={costEstimate}
        archDescription={archDescription}
        isGenerating={isGenerating}
        terraformProgress={terraformProgress}
        setupPdfState={setupPdfState}
        setupPdfGenerationReady={generationCompleted}
        onGenerateSetupPdf={requestSetupPdfGeneration}
        onDownloadSetupPdf={requestSetupPdfDownload}
      />
    </div>
  );
}
