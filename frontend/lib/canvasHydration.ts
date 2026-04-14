import type { ConnectionState } from "./websocket";
import type { ArchDescription } from "@/components/ArchDescriptionViewer";
import type { TerraformFile } from "@/components/OutputPanel";
import type { CanvasMessage, CostBreakdown } from "@/lib/projects";
import type { Edge, Node } from "reactflow";

type ShouldHydrateFromProjectArgs = {
  isFreshSession: boolean;
  projectUpdatedAt: string;
  lastHydratedUpdatedAt: string | null;
  generationActive: boolean;
  liveSession: boolean;
  wsState: ConnectionState;
};

export function shouldHydrateFromProject({
  isFreshSession,
  projectUpdatedAt,
  lastHydratedUpdatedAt,
  generationActive,
  liveSession,
  wsState,
}: ShouldHydrateFromProjectArgs): boolean {
  if (isFreshSession) {
    return true;
  }

  if (projectUpdatedAt === lastHydratedUpdatedAt) {
    return false;
  }

  // While generation is active and WS is open for live sessions, WS events are authoritative.
  if (generationActive && liveSession && wsState === "open") {
    return false;
  }

  return true;
}

type ShouldApplySnapshotTerraformFilesArgs = {
  generationStatus: string | null;
  isGenerating: boolean;
};

export function shouldApplySnapshotTerraformFiles({
  generationStatus,
  isGenerating,
}: ShouldApplySnapshotTerraformFilesArgs): boolean {
  if (!isGenerating) {
    return true;
  }

  return generationStatus === "completed" || generationStatus === "failed" || generationStatus === "idle";
}

export type ProjectHydrationSnapshot = {
  chatHistory: CanvasMessage[];
  terraformFiles: TerraformFile[];
  archDescription: ArchDescription | null;
  costEstimate: CostBreakdown | null;
  nodes: Node[];
  edges: Edge[];
  updatedAt: string;
};

export function projectHydrationSnapshot(project: ProjectHydrationSnapshot): ProjectHydrationSnapshot {
  return {
    chatHistory: project.chatHistory,
    terraformFiles: project.terraformFiles,
    archDescription: project.archDescription,
    costEstimate: project.costEstimate,
    nodes: project.nodes,
    edges: project.edges,
    updatedAt: project.updatedAt,
  };
}

export type ManualTerraformRunState = "idle" | "running" | "completed" | "failed";

type GetManualTerraformRunStateFromSnapshotArgs = {
  currentState: ManualTerraformRunState;
  generationStage: string | undefined;
  generationStatus: string | undefined;
};

export function getManualTerraformRunStateFromSnapshot({
  currentState,
  generationStage,
  generationStatus,
}: GetManualTerraformRunStateFromSnapshotArgs): ManualTerraformRunState | null {
  if (generationStage === "code_generation" && generationStatus === "completed" && currentState === "running") {
    return "completed";
  }
  if (generationStage === "code_generation" && generationStatus === "failed" && currentState === "running") {
    return "failed";
  }
  return null;
}
