import { describe, expect, it } from "vitest";
import type { CanvasSession } from "../projects";
import { resolveGenerationProjectId } from "../generationSession";

describe("resolveGenerationProjectId", () => {
  it("uses the existing project id for persisted sessions", () => {
    const session = {
      mode: "existing",
      project: { id: "project-existing" },
    } as CanvasSession;

    expect(resolveGenerationProjectId(session, "fallback-project")).toBe("project-existing");
  });

  it("uses in-memory project id for chat-first and new sessions", () => {
    const chatFirstSession = {
      mode: "chat_first",
      answers: {},
      projectId: "chat-first-project",
      shareSlug: null,
    } as CanvasSession;

    const newSession = {
      mode: "new",
      answers: {},
      projectId: "new-project",
      shareSlug: null,
    } as CanvasSession;

    expect(resolveGenerationProjectId(chatFirstSession, "fallback-project")).toBe("chat-first-project");
    expect(resolveGenerationProjectId(newSession, "fallback-project")).toBe("new-project");
  });

  it("falls back to discovery project id when session project id is missing", () => {
    const session = {
      mode: "chat_first",
      answers: {},
      projectId: null,
      shareSlug: null,
    } as CanvasSession;

    expect(resolveGenerationProjectId(session, "fallback-project")).toBe("fallback-project");
  });

  it("returns undefined when no project id is available", () => {
    const session = {
      mode: "new",
      answers: {},
      projectId: null,
      shareSlug: null,
    } as CanvasSession;

    expect(resolveGenerationProjectId(session, null)).toBeUndefined();
    expect(resolveGenerationProjectId(null, "fallback-project")).toBeUndefined();
  });
});
