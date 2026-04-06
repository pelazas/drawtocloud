import { describe, expect, it, vi } from "vitest";
import type { Edge, Node } from "reactflow";

vi.mock("../projectApi", () => ({
  createProject: vi.fn(),
  saveSnapshot: vi.fn(),
}));

import {
  canStartSave,
  createProjectWithSnapshot,
  decideSaveIntent,
  saveOwnedProjectSnapshot,
  shouldOpenSaveModal,
} from "../useSaveProject";

function node(id: string): Node {
  return {
    id,
    data: {},
    position: { x: 0, y: 0 },
  };
}

function edge(id: string, source = "node-1", target = "node-2"): Edge {
  return {
    id,
    source,
    target,
  };
}

describe("useSaveProject helpers", () => {
  it("decides to create new when there is no current project", () => {
    expect(decideSaveIntent(null, false)).toBe("create-new");
    expect(decideSaveIntent(null, true)).toBe("create-new");
  });

  it("decides to save owned project when owner", () => {
    expect(decideSaveIntent({ id: "project-1" }, true)).toBe("save-owned");
  });

  it("opens save modal for both create-new and save-owned intents", () => {
    expect(shouldOpenSaveModal("create-new")).toBe(true);
    expect(shouldOpenSaveModal("save-owned")).toBe(true);
    expect(shouldOpenSaveModal("forbidden")).toBe(false);
  });

  it("decides forbidden when current project is not owned", () => {
    expect(decideSaveIntent({ id: "project-1" }, false)).toBe("forbidden");
  });

  it("blocks starting a save while another save is in progress or lock is in-flight", () => {
    expect(canStartSave(false, false)).toBe(true);
    expect(canStartSave(true, false)).toBe(false);
    expect(canStartSave(false, true)).toBe(false);
  });

  it("saves owned project snapshot and toasts success", async () => {
    const saveSnapshotFn = vi.fn().mockResolvedValue(undefined);
    const toastApi = { success: vi.fn(), error: vi.fn() };
    const nodes = [node("node-1")];
    const edges = [edge("edge-1")];

    await expect(
      saveOwnedProjectSnapshot({
        projectId: "project-1",
        nodes,
        edges,
        saveSnapshotFn,
        toastApi,
      })
    ).resolves.toBeUndefined();

    expect(saveSnapshotFn).toHaveBeenCalledWith("project-1", nodes, edges);
    expect(toastApi.success).toHaveBeenCalledTimes(1);
    expect(toastApi.error).not.toHaveBeenCalled();
  });

  it("toasts and rethrows when owned project snapshot fails", async () => {
    const saveSnapshotFn = vi.fn().mockRejectedValue(new Error("Snapshot failed"));
    const toastApi = { success: vi.fn(), error: vi.fn() };

    await expect(
      saveOwnedProjectSnapshot({
        projectId: "project-1",
        nodes: [],
        edges: [],
        saveSnapshotFn,
        toastApi,
      })
    ).rejects.toThrow("Snapshot failed");

    expect(toastApi.success).not.toHaveBeenCalled();
    expect(toastApi.error).toHaveBeenCalledWith("Snapshot failed");
  });

  it("creates project, saves snapshot, redirects, and toasts success", async () => {
    const createProjectFn = vi.fn().mockResolvedValue({
      project_id: "project-1",
      share_slug: "share-1",
    });
    const saveSnapshotFn = vi.fn().mockResolvedValue(undefined);
    const resolveRedirectPathFn = vi.fn().mockReturnValue("/?project=share-1");
    const replaceRoute = vi.fn();
    const toastApi = { success: vi.fn(), error: vi.fn() };

    await expect(
      createProjectWithSnapshot({
        name: "New Project",
        nodes: [node("node-1")],
        edges: [edge("edge-1")],
        createProjectFn,
        saveSnapshotFn,
        resolveRedirectPathFn,
        replaceRoute,
        toastApi,
      })
    ).resolves.toBeUndefined();

    expect(createProjectFn).toHaveBeenCalledWith("New Project");
    expect(saveSnapshotFn).toHaveBeenCalledWith("project-1", [node("node-1")], [edge("edge-1")]);
    expect(resolveRedirectPathFn).toHaveBeenCalledWith("share-1");
    expect(replaceRoute).toHaveBeenCalledWith("/?project=share-1");
    expect(toastApi.success).toHaveBeenCalledTimes(1);
    expect(toastApi.error).not.toHaveBeenCalled();

    const createCallOrder = createProjectFn.mock.invocationCallOrder[0];
    const saveCallOrder = saveSnapshotFn.mock.invocationCallOrder[0];
    const replaceCallOrder = replaceRoute.mock.invocationCallOrder[0];
    expect(createCallOrder).toBeLessThan(saveCallOrder);
    expect(saveCallOrder).toBeLessThan(replaceCallOrder);
  });

  it("toasts and rethrows when creating new project fails", async () => {
    const createProjectFn = vi.fn().mockRejectedValue(new Error("Create failed"));
    const saveSnapshotFn = vi.fn().mockResolvedValue(undefined);
    const resolveRedirectPathFn = vi.fn().mockReturnValue("/?project=share-1");
    const replaceRoute = vi.fn();
    const toastApi = { success: vi.fn(), error: vi.fn() };

    await expect(
      createProjectWithSnapshot({
        name: "New Project",
        nodes: [],
        edges: [],
        createProjectFn,
        saveSnapshotFn,
        resolveRedirectPathFn,
        replaceRoute,
        toastApi,
      })
    ).rejects.toThrow("Create failed");

    expect(saveSnapshotFn).not.toHaveBeenCalled();
    expect(replaceRoute).not.toHaveBeenCalled();
    expect(toastApi.success).not.toHaveBeenCalled();
    expect(toastApi.error).toHaveBeenCalledWith("Create failed");
  });

  it("toasts and rethrows when new project snapshot fails", async () => {
    const createProjectFn = vi.fn().mockResolvedValue({
      project_id: "project-1",
      share_slug: "share-1",
    });
    const saveSnapshotFn = vi.fn().mockRejectedValue(new Error("Save failed"));
    const resolveRedirectPathFn = vi.fn().mockReturnValue("/?project=share-1");
    const replaceRoute = vi.fn();
    const toastApi = { success: vi.fn(), error: vi.fn() };

    await expect(
      createProjectWithSnapshot({
        name: "New Project",
        nodes: [],
        edges: [],
        createProjectFn,
        saveSnapshotFn,
        resolveRedirectPathFn,
        replaceRoute,
        toastApi,
      })
    ).rejects.toThrow("Save failed");

    expect(replaceRoute).not.toHaveBeenCalled();
    expect(toastApi.success).not.toHaveBeenCalled();
    expect(toastApi.error).toHaveBeenCalledWith("Save failed");
  });
});
