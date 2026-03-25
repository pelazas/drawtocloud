"use client";
import TerraformViewer, { TerraformFile, TerraformProgress } from "./TerraformViewer";
import { ArchDescription } from "./ArchDescriptionViewer";
import SetupPdfActions from "./SetupPdfActions";
import type { SetupPdfState } from "@/lib/setupPdf";

export type { TerraformFile, ArchDescription };

type Props = {
  terraformFiles: TerraformFile[];
  archDescription: ArchDescription | null;
  isGenerating: boolean;
  terraformProgress?: TerraformProgress;
  setupPdfState?: SetupPdfState;
  setupPdfGenerationReady?: boolean;
  onGenerateSetupPdf?: () => void;
  onDownloadSetupPdf?: () => void;
  readOnly?: boolean;
};

export default function OutputPanel({
  terraformFiles,
  archDescription: _archDescription,
  isGenerating,
  terraformProgress,
  setupPdfState,
  setupPdfGenerationReady = false,
  onGenerateSetupPdf,
  onDownloadSetupPdf,
  readOnly = false,
}: Props) {
  void _archDescription;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {readOnly && (
        <div className="border-b border-gray-800 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-400">
          Shared View
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <TerraformViewer files={terraformFiles} isGenerating={isGenerating} terraformProgress={terraformProgress} />
      </div>

      {setupPdfState && onGenerateSetupPdf && onDownloadSetupPdf && (
        <div className="relative z-30 bg-gray-950">
          <SetupPdfActions
            state={setupPdfState}
            canGenerate={setupPdfGenerationReady}
            onGenerate={onGenerateSetupPdf}
            onDownload={onDownloadSetupPdf}
            readOnly={readOnly}
          />
        </div>
      )}
    </div>
  );
}
