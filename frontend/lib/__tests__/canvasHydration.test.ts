import { describe, expect, it } from "vitest";
import { shouldHydrateFromProject } from "../canvasHydration";

describe("shouldHydrateFromProject", () => {
  it("hydrates when session is fresh", () => {
    expect(
      shouldHydrateFromProject({
        isFreshSession: true,
        projectUpdatedAt: "2026-03-19T10:00:00.000Z",
        lastHydratedUpdatedAt: "2026-03-19T09:00:00.000Z",
        generationActive: true,
        liveSession: true,
        wsState: "open",
      })
    ).toBe(true);
  });

  it("hydrates completed projects from DB when websocket is open and updatedAt changed", () => {
    expect(
      shouldHydrateFromProject({
        isFreshSession: false,
        projectUpdatedAt: "2026-03-19T10:00:00.000Z",
        lastHydratedUpdatedAt: "2026-03-19T09:00:00.000Z",
        generationActive: false,
        liveSession: true,
        wsState: "open",
      })
    ).toBe(true);
  });

  it("skips DB hydration while actively generating with open websocket in live session", () => {
    expect(
      shouldHydrateFromProject({
        isFreshSession: false,
        projectUpdatedAt: "2026-03-19T10:00:00.000Z",
        lastHydratedUpdatedAt: "2026-03-19T09:00:00.000Z",
        generationActive: true,
        liveSession: true,
        wsState: "open",
      })
    ).toBe(false);
  });

  it("does not hydrate when project data has already been hydrated", () => {
    expect(
      shouldHydrateFromProject({
        isFreshSession: false,
        projectUpdatedAt: "2026-03-19T10:00:00.000Z",
        lastHydratedUpdatedAt: "2026-03-19T10:00:00.000Z",
        generationActive: false,
        liveSession: true,
        wsState: "open",
      })
    ).toBe(false);
  });

  it("hydrates when actively generating if websocket is not open", () => {
    expect(
      shouldHydrateFromProject({
        isFreshSession: false,
        projectUpdatedAt: "2026-03-19T10:00:00.000Z",
        lastHydratedUpdatedAt: "2026-03-19T09:00:00.000Z",
        generationActive: true,
        liveSession: true,
        wsState: "closed",
      })
    ).toBe(true);
  });

  it("hydrates from DB when not in a live session, even if websocket is open", () => {
    expect(
      shouldHydrateFromProject({
        isFreshSession: false,
        projectUpdatedAt: "2026-03-19T10:00:00.000Z",
        lastHydratedUpdatedAt: "2026-03-19T09:00:00.000Z",
        generationActive: true,
        liveSession: false,
        wsState: "open",
      })
    ).toBe(true);
  });
});
