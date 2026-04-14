import { describe, expect, it } from "vitest";
import { shouldApplySnapshotTerraformFiles } from "../canvasHydration";

type TerraformFile = { filename: string; content: string; description?: string };

function applySnapshotTerraformFiles(
  currentFiles: TerraformFile[],
  snapshotTerraformFiles: TerraformFile[] | null,
  isGenerating: boolean,
  generationStatus: string | null,
): TerraformFile[] {
  if (
    snapshotTerraformFiles &&
    shouldApplySnapshotTerraformFiles({
      generationStatus,
      isGenerating,
    })
  ) {
    return snapshotTerraformFiles;
  }
  return currentFiles;
}

describe("stale snapshot terraform_files guard", () => {
  it("does NOT overwrite existing terraform files when snapshot arrives with empty array during active generation", () => {
    const existingFiles: TerraformFile[] = [
      { filename: "main.tf", content: "# main", description: "Main config" },
    ];
    const isGenerating = true;

    const result = applySnapshotTerraformFiles(existingFiles, [], isGenerating, "running");

    expect(result).toEqual(existingFiles);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("main.tf");
  });

  it("applies terminal snapshot terraform files even if local state still says generating", () => {
    const existingFiles: TerraformFile[] = [
      { filename: "main.tf", content: "# main", description: "Main config" },
    ];
    const snapshotFiles: TerraformFile[] = [
      { filename: "main.tf", content: "# refreshed", description: "Main config" },
      { filename: "variables.tf", content: "# vars", description: "Variables" },
    ];
    const isGenerating = true;

    const result = applySnapshotTerraformFiles(existingFiles, snapshotFiles, isGenerating, "completed");

    expect(result).toEqual(snapshotFiles);
    expect(result).toHaveLength(2);
  });

  it("applies non-empty snapshot terraform_files when not generating", () => {
    const existingFiles: TerraformFile[] = [
      { filename: "main.tf", content: "# old", description: "Old main" },
    ];
    const snapshotFiles: TerraformFile[] = [
      { filename: "main.tf", content: "# new", description: "New main" },
      { filename: "variables.tf", content: "# vars", description: "Variables" },
    ];
    const isGenerating = false;

    const result = applySnapshotTerraformFiles(existingFiles, snapshotFiles, isGenerating, "completed");

    expect(result).toEqual(snapshotFiles);
    expect(result).toHaveLength(2);
  });

  it("preserves existing files when snapshot is null and not generating", () => {
    const existingFiles: TerraformFile[] = [
      { filename: "main.tf", content: "# main", description: "Main config" },
    ];
    const isGenerating = false;

    const result = applySnapshotTerraformFiles(existingFiles, null, isGenerating, "idle");

    expect(result).toEqual(existingFiles);
    expect(result).toHaveLength(1);
  });

  it("keeps existing files during active running snapshot even when snapshot is non-empty", () => {
    const existingFiles: TerraformFile[] = [
      { filename: "main.tf", content: "# main", description: "Main config" },
    ];
    const snapshotFiles: TerraformFile[] = [
      { filename: "variables.tf", content: "# vars", description: "Variables" },
    ];

    const result = applySnapshotTerraformFiles(existingFiles, snapshotFiles, true, "running");

    expect(result).toEqual(existingFiles);
  });
});
