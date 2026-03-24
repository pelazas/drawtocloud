"use client";
import { useState } from "react";
import TerraformViewer, { TerraformFile, TerraformProgress } from "./TerraformViewer";
import CostTable, { CostEstimate } from "./CostTable";
import ArchDescriptionViewer, { ArchDescription } from "./ArchDescriptionViewer";
import SetupPdfActions from "./SetupPdfActions";
import type { SetupPdfState } from "@/lib/setupPdf";

export type { TerraformFile, CostEstimate, ArchDescription };

type Tab = "terraform" | "cost" | "description";

type Props = {
  terraformFiles: TerraformFile[];
  costEstimate: CostEstimate | null;
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
  costEstimate,
  archDescription,
  isGenerating,
  terraformProgress,
  setupPdfState,
  setupPdfGenerationReady = false,
  onGenerateSetupPdf,
  onDownloadSetupPdf,
  readOnly = false,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("terraform");

  return (
    <div className="flex-1 flex flex-col">
      {readOnly && (
        <div className="border-b border-gray-800 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-400">
          Shared View
        </div>
      )}
      {/* Tab bar */}
      <div className="flex border-b border-gray-800 flex-shrink-0">
        <button
          onClick={() => setActiveTab("terraform")}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${
            activeTab === "terraform"
              ? "text-white border-b-2 border-blue-500"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Terraform
          {terraformFiles.length > 0 && (
            <span className="ml-1 text-blue-400">({terraformFiles.length})</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("cost")}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${
            activeTab === "cost"
              ? "text-white border-b-2 border-blue-500"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Cost
          {costEstimate && (
            <span className="ml-1 text-green-400">
              ${costEstimate.monthly_total.toFixed(0)}/mo
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("description")}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${
            activeTab === "description"
              ? "text-white border-b-2 border-blue-500"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Description
          {archDescription && (
            <span className="ml-1 text-blue-400">●</span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "terraform" ? (
          <TerraformViewer files={terraformFiles} isGenerating={isGenerating} terraformProgress={terraformProgress} />
        ) : activeTab === "cost" ? (
          <CostTable estimate={costEstimate} isGenerating={isGenerating} />
        ) : (
          <ArchDescriptionViewer sections={archDescription} isGenerating={isGenerating} />
        )}
      </div>

      {setupPdfState && onGenerateSetupPdf && onDownloadSetupPdf && (
        <SetupPdfActions
          state={setupPdfState}
          canGenerate={setupPdfGenerationReady}
          onGenerate={onGenerateSetupPdf}
          onDownload={onDownloadSetupPdf}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
