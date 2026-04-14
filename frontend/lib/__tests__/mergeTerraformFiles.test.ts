import { describe, expect, it } from "vitest";
import { mergeTerraformFiles } from "../canvasHydration";
import type { TerraformFile } from "@/components/OutputPanel";

describe("mergeTerraformFiles", () => {
  it("returns existing files when snapshot is empty during generation", () => {
    const existing: TerraformFile[] = [
      { filename: "main.tf", content: "# existing main", description: "" },
      { filename: "variables.tf", content: "# vars", description: "" },
    ];
    const result = mergeTerraformFiles(existing, [], true);
    expect(result).toEqual(existing);
    expect(result.length).toBe(2);
  });

  it("merges snapshot into existing during active generation (recovers missed live file)", () => {
    const existing: TerraformFile[] = [
      { filename: "variables.tf", content: "# vars", description: "" },
      { filename: "outputs.tf", content: "# outputs", description: "" },
      { filename: "terraform.tfvars", content: "# tfvars", description: "" },
    ];
    const snapshot: TerraformFile[] = [
      { filename: "main.tf", content: "# main from snapshot", description: "" },
      { filename: "variables.tf", content: "# vars", description: "" },
      { filename: "outputs.tf", content: "# outputs", description: "" },
      { filename: "terraform.tfvars", content: "# tfvars", description: "" },
    ];
    const result = mergeTerraformFiles(existing, snapshot, true);
    expect(result.length).toBe(4);
    expect(result.find((f) => f.filename === "main.tf")?.content).toBe("# main from snapshot");
    expect(result.find((f) => f.filename === "variables.tf")?.content).toBe("# vars");
  });

  it("replaces existing with snapshot when not generating", () => {
    const existing: TerraformFile[] = [
      { filename: "main.tf", content: "# old", description: "" },
    ];
    const snapshot: TerraformFile[] = [
      { filename: "main.tf", content: "# new", description: "" },
      { filename: "variables.tf", content: "# vars", description: "" },
    ];
    const result = mergeTerraformFiles(existing, snapshot, false);
    expect(result).toEqual(snapshot);
    expect(result.length).toBe(2);
  });

  it("does not overwrite newer live file with older snapshot file of same name", () => {
    const existing: TerraformFile[] = [
      { filename: "main.tf", content: "# newer live main", description: "" },
      { filename: "variables.tf", content: "# vars", description: "" },
    ];
    const snapshot: TerraformFile[] = [
      { filename: "main.tf", content: "# older snapshot main", description: "" },
    ];
    const result = mergeTerraformFiles(existing, snapshot, true);
    expect(result.find((f) => f.filename === "main.tf")?.content).toBe("# newer live main");
  });

  it("recovers main.tf when it was missed in live events but present in snapshot", () => {
    const liveOnlyFiles: TerraformFile[] = [
      { filename: "variables.tf", content: "# vars", description: "" },
      { filename: "outputs.tf", content: "# outputs", description: "" },
      { filename: "terraform.tfvars", content: "# tfvars", description: "" },
    ];
    const snapshotWithMain: TerraformFile[] = [
      { filename: "main.tf", content: "# recovered main", description: "" },
      { filename: "variables.tf", content: "# vars", description: "" },
      { filename: "outputs.tf", content: "# outputs", description: "" },
      { filename: "terraform.tfvars", content: "# tfvars", description: "" },
    ];
    const result = mergeTerraformFiles(liveOnlyFiles, snapshotWithMain, true);
    expect(result.length).toBe(4);
    expect(result.some((f) => f.filename === "main.tf")).toBe(true);
    expect(result.find((f) => f.filename === "main.tf")?.content).toBe("# recovered main");
  });

  it("returns existing when snapshot is empty and not generating", () => {
    const existing: TerraformFile[] = [
      { filename: "main.tf", content: "# existing", description: "" },
    ];
    const result = mergeTerraformFiles(existing, [], false);
    expect(result).toEqual(existing);
  });

  it("handles null snapshot gracefully", () => {
    const existing: TerraformFile[] = [
      { filename: "main.tf", content: "# existing", description: "" },
    ];
    const result = mergeTerraformFiles(existing, null as unknown as TerraformFile[], true);
    expect(result).toEqual(existing);
  });
});