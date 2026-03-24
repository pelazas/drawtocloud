"use client";

import { X } from "lucide-react";
import OutputPanel, { type CostEstimate, type TerraformFile } from "@/components/OutputPanel";
import type { ArchDescription } from "@/components/ArchDescriptionViewer";
import MyDesignsList from "@/components/RightPanel/MyDesignsList";
import type { ProjectSummary } from "@/lib/projects";
import type { SetupPdfState } from "@/lib/setupPdf";
import type { TerraformProgress } from "@/components/TerraformViewer";
import type { RightPanelTab } from "@/lib/useWorkspace";

interface RightPanelProps {
  open: boolean;
  tab: RightPanelTab;
  onClose: () => void;

  terraformFiles: TerraformFile[];
  costEstimate: CostEstimate | null;
  archDescription: ArchDescription | null;
  isGenerating: boolean;
  terraformProgress?: TerraformProgress;
  setupPdfState?: SetupPdfState;
  setupPdfGenerationReady?: boolean;
  onGenerateSetupPdf?: () => void;
  onDownloadSetupPdf?: () => void;

  projects: ProjectSummary[];
  projectsLoading: boolean;
  onOpenProject: (slug: string) => void;
  onDeleteProject: (id: string) => void;
  pendingDeleteId: string | null;
  isDeleting: boolean;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete: () => void;
}

export default function RightPanel({
  open,
  tab,
  onClose,
  terraformFiles,
  costEstimate,
  archDescription,
  isGenerating,
  terraformProgress,
  setupPdfState,
  setupPdfGenerationReady,
  onGenerateSetupPdf,
  onDownloadSetupPdf,
  projects,
  projectsLoading,
  onOpenProject,
  onDeleteProject,
  pendingDeleteId,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
}: RightPanelProps) {
  const tabTitle = tab === "output" ? "Output" : "My Designs";

  return (
    <div
      className={`w-80 flex-shrink-0 h-full border-l border-gray-800 bg-gray-950 transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
      style={{ marginRight: open ? 0 : "-20rem" }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white">{tabTitle}</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          aria-label="Close right panel"
        >
          <X size={16} />
        </button>
      </div>

      <div className="h-[calc(100%-49px)] flex flex-col">
        {tab === "output" ? (
          <OutputPanel
            terraformFiles={terraformFiles}
            costEstimate={costEstimate}
            archDescription={archDescription}
            isGenerating={isGenerating}
            terraformProgress={terraformProgress}
            setupPdfState={setupPdfState}
            setupPdfGenerationReady={setupPdfGenerationReady}
            onGenerateSetupPdf={onGenerateSetupPdf}
            onDownloadSetupPdf={onDownloadSetupPdf}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
}
