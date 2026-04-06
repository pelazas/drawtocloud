type GenerationSnapshotHydrationParams = {
  generationActive: boolean;
  nodeCount: number;
  edgeCount: number;
};

export function shouldHydrateGenerationSnapshot({
  generationActive,
  nodeCount,
  edgeCount,
}: GenerationSnapshotHydrationParams): boolean {
  if (!generationActive) return true;
  return nodeCount === 0 && edgeCount === 0;
}
