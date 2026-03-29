import { describe, expect, it, vi } from "vitest";
import type { CanvasSession } from "../projects";
import { ensureChatProjectContext, type ChatProjectBootstrapState } from "../chatProjectContext";

describe("ensureChatProjectContext", () => {
  it("reuses project context from an existing session", async () => {
    const canvasSession = {
      mode: "existing",
      project: { id: "project-existing", shareSlug: "existing-slug" },
    } as CanvasSession;

    const createProject = vi.fn();
    const saveSnapshot = vi.fn();

    await expect(
      ensureChatProjectContext({
        canvasSession,
        bootstrapState: { context: null, pending: null },
        createProject,
        saveSnapshot,
        nodes: [],
        edges: [],
      })
    ).resolves.toEqual({ projectId: "project-existing", shareSlug: "existing-slug" });
    expect(createProject).not.toHaveBeenCalled();
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it("creates a project and saves a snapshot when no project context exists", async () => {
    const bootstrapState: ChatProjectBootstrapState = { context: null, pending: null };
    const createProject = vi.fn(async () => ({ project_id: "project-new", share_slug: "new-slug" }));
    const saveSnapshot = vi.fn(async () => undefined);
    const onProjectReady = vi.fn();
    const nodes = [{ id: "n1" }];
    const edges = [{ source: "n1", target: "n2" }];

    const context = await ensureChatProjectContext({
      canvasSession: null,
      bootstrapState,
      createProject,
      saveSnapshot,
      onProjectReady,
      nodes,
      edges,
      projectName: "Template Project",
    });

    expect(context).toEqual({ projectId: "project-new", shareSlug: "new-slug" });
    expect(createProject).toHaveBeenCalledOnce();
    expect(createProject).toHaveBeenCalledWith("Template Project");
    expect(saveSnapshot).toHaveBeenCalledOnce();
    expect(saveSnapshot).toHaveBeenCalledWith("project-new", nodes, edges);
    expect(onProjectReady).toHaveBeenCalledWith("project-new", "new-slug");
    expect(bootstrapState.context).toEqual({ projectId: "project-new", shareSlug: "new-slug" });
  });

  it("reuses an in-flight project bootstrap to avoid duplicate project creation", async () => {
    let releaseCreate!: (value: { project_id: string; share_slug: string }) => void;
    const createProjectPromise = new Promise<{ project_id: string; share_slug: string }>((resolve) => {
      releaseCreate = resolve;
    });
    const createProject = vi.fn(() => createProjectPromise);
    const saveSnapshot = vi.fn(async () => undefined);
    const bootstrapState: ChatProjectBootstrapState = { context: null, pending: null };

    const firstCall = ensureChatProjectContext({
      canvasSession: null,
      bootstrapState,
      createProject,
      saveSnapshot,
      nodes: [],
      edges: [],
    });
    const secondCall = ensureChatProjectContext({
      canvasSession: null,
      bootstrapState,
      createProject,
      saveSnapshot,
      nodes: [],
      edges: [],
    });

    releaseCreate({ project_id: "project-shared", share_slug: "shared-slug" });
    const [firstContext, secondContext] = await Promise.all([firstCall, secondCall]);

    expect(firstContext).toEqual({ projectId: "project-shared", shareSlug: "shared-slug" });
    expect(secondContext).toEqual({ projectId: "project-shared", shareSlug: "shared-slug" });
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(saveSnapshot).toHaveBeenCalledTimes(1);
  });
});
