"use client";

import { LayoutGrid, X } from "lucide-react";
import OutputPanel, { type TerraformFile } from "@/components/OutputPanel";
import type { ArchDescription } from "@/components/ArchDescriptionViewer";
import GenerationObservabilityPanel from "@/components/GenerationObservabilityPanel";
import MyDesignsList from "@/components/RightPanel/MyDesignsList";
import TemplatesPanel from "@/components/RightPanel/TemplatesPanel";
import type { ProjectSummary } from "@/lib/projects";
import type { SetupPdfState } from "@/lib/setupPdf";
import type { TerraformProgress } from "@/components/TerraformViewer";
import type { RightPanelTab } from "@/lib/useWorkspace";
import type { GenerationAgentState } from "@/lib/generationObservability";
import type { AgentLogEntry } from "@/lib/useCanvasPipeline";

interface RightPanelProps {
  open: boolean;
  tab: RightPanelTab;
  onClose: () => void;

  generationAgents: GenerationAgentState[] | null;
  architectureAgents: GenerationAgentState[] | null;
  agentLogs: AgentLogEntry[];
  isGenerating: boolean;
  generationElapsed?: number;

  terraformFiles: TerraformFile[];
  archDescription: ArchDescription | null;
  terraformProgress?: TerraformProgress;
  terraformOutdated?: boolean;
  isManualTerraformRun?: boolean;
  onRegenerateTerraform?: () => void;
  setupPdfState?: SetupPdfState;
  setupPdfGenerationReady?: boolean;
  onGenerateSetupPdf?: () => void;
  onDownloadSetupPdf?: () => void;

  projects: ProjectSummary[];
  projectsLoading: boolean;
  onOpenProject: (slug: string) => void;
  onDeleteProject: (id: string) => void;
  onUseTemplate: (slug: string) => void;
  pendingDeleteId: string | null;
  isDeleting: boolean;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete: () => void;
}

export default function RightPanel({
  open,
  tab,
  onClose,
  generationAgents,
  architectureAgents,
  agentLogs,
  isGenerating,
  generationElapsed,
  terraformFiles,
  archDescription,
  terraformProgress,
  terraformOutdated,
  isManualTerraformRun,
  onRegenerateTerraform,
  setupPdfState,
  setupPdfGenerationReady,
  onGenerateSetupPdf,
  onDownloadSetupPdf,
  projects,
  projectsLoading,
  onOpenProject,
  onDeleteProject,
  onUseTemplate,
  pendingDeleteId,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
}: RightPanelProps) {
  const fileLabel = terraformFiles.length === 1 ? "file" : "files";
  const tabTitle = tab === "designs" ? "My Designs" : tab === "generation" ? "Architecture Generation" : "Templates";
  const isTemplatesTab = tab === "templates";

  return (
    <div
      className={`w-80 flex-shrink-0 h-full border-l border-gray-800 bg-gray-950 transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
      style={{ marginRight: open ? 0 : "-20rem" }}
    >
      <div className={`flex items-center justify-between px-4 py-4 border-b ${isTemplatesTab ? "border-[#1b2339] bg-[#0b1020]" : "border-gray-800"}`}>
        <h2 className={`flex items-center gap-2 text-sm ${isTemplatesTab ? "font-semibold tracking-[0.02em] text-[#e4ebff]" : "font-semibold text-white"}`}>
          {isTemplatesTab && <LayoutGrid size={15} className="text-blue-500" />}
          {tab === "output" ? (
            <>
              Output
              <span className="text-red-400">({terraformFiles.length} {fileLabel})</span>
            </>
          ) : (
            tabTitle
          )}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className={`p-1 rounded transition-colors ${isTemplatesTab ? "text-[#6e7aa5] hover:text-[#c6d4ff] hover:bg-[#131a30]" : "text-gray-400 hover:text-white hover:bg-gray-800"}`}
          aria-label="Close right panel"
        >
          <X size={16} />
        </button>
      </div>

      <div className="h-[calc(100%-49px)] flex flex-col">
        {tab === "generation" ? (
          <GenerationObservabilityPanel
            agents={generationAgents}
            initialAgents={architectureAgents}
            agentLogs={agentLogs}
            isGenerating={isGenerating}
            generationElapsed={generationElapsed}
            terraformProgress={terraformProgress}
            isManualTerraformRun={isManualTerraformRun}
          />
        ) : tab === "output" ? (
          <OutputPanel
            terraformFiles={terraformFiles}
            archDescription={archDescription}
            isGenerating={isGenerating}
            terraformProgress={terraformProgress}
            terraformOutdated={terraformOutdated}
            onRegenerateTerraform={onRegenerateTerraform}
            setupPdfState={setupPdfState}
            setupPdfGenerationReady={setupPdfGenerationReady}
            onGenerateSetupPdf={onGenerateSetupPdf}
            onDownloadSetupPdf={onDownloadSetupPdf}
          />
        ) : tab === "designs" ? (
          <MyDesignsList
            projects={projects}
            loading={projectsLoading}
            onOpen={onOpenProject}
            onDelete={onDeleteProject}
            pendingDeleteId={pendingDeleteId}
            isDeleting={isDeleting}
            onConfirmDelete={onConfirmDelete}
            onCancelDelete={onCancelDelete}
          />
        ) : (
          <TemplatesPanel onUseTemplate={onUseTemplate} />
        )}
      </div>
    </div>
  );
}
