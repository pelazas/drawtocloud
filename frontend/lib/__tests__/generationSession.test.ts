import { describe, expect, it } from "vitest";
import type { CanvasSession } from "../projects";
import { resolveGenerationProjectId } from "../generationSession";

describe("resolveGenerationProjectId", () => {
  it("uses the existing project id for persisted sessions", () => {
    const session = {
      mode: "existing",
      project: { id: "project-existing" },
    } as CanvasSession;

    expect(resolveGenerationProjectId(session)).toBe("project-existing");
  });

  it("uses in-memory project id for new sessions", () => {
    const newSession = {
      mode: "new",
      answers: {},
      projectId: "new-project",
      shareSlug: null,
    } as CanvasSession;

    expect(resolveGenerationProjectId(newSession)).toBe("new-project");
  });

  it("returns undefined when no project id is available", () => {
    const session = {
      mode: "new",
      answers: {},
      projectId: null,
      shareSlug: null,
    } as CanvasSession;

    expect(resolveGenerationProjectId(session)).toBeUndefined();
    expect(resolveGenerationProjectId(null)).toBeUndefined();
  });
});
