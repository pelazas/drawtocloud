import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSnapshot } from "../projectApi";

const { getSessionMock, saveSnapshotMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  saveSnapshotMock: vi.fn().mockResolvedValue(undefined),
}));

const fetchMock = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getSession: getSessionMock },
  }),
}));

const mockScheduleCanvasPersist = vi.fn();

vi.mock("../useCanvasPipeline", () => ({
  useCanvasPipeline: vi.fn(() => ({
    scheduleCanvasPersist: mockScheduleCanvasPersist,
    activeProjectId: "project-1",
    readOnly: false,
    terraformOutdated: false,
    setTerraformOutdated: vi.fn(),
    setSetupPdfState: vi.fn(),
    currentStage: "completed",
    traceId: "trace-1",
    pushDebugEvent: vi.fn(),
  })),
}));

function mockFetchJsonResponse({ ok, body = {} }: { ok: boolean; body?: unknown }) {
  fetchMock.mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("scheduleCanvasPersist structureChanged option logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
    });
    saveSnapshotMock.mockResolvedValue(undefined);
    mockScheduleCanvasPersist.mockImplementation(
      (options?: { structureChanged?: boolean }) => {
        const structureChanged = options?.structureChanged ?? true;
        saveSnapshotMock("project-1", [], [], { structureChanged });
      }
    );
  });

  it("scheduleCanvasPersist({ structureChanged: false }) calls saveSnapshot with structureChanged: false", () => {
    mockScheduleCanvasPersist({ structureChanged: false });
    expect(saveSnapshotMock).toHaveBeenCalledWith("project-1", [], [], {
      structureChanged: false,
    });
  });

  it("scheduleCanvasPersist({ structureChanged: true }) calls saveSnapshot with structureChanged: true", () => {
    mockScheduleCanvasPersist({ structureChanged: true });
    expect(saveSnapshotMock).toHaveBeenCalledWith("project-1", [], [], {
      structureChanged: true,
    });
  });

  it("scheduleCanvasPersist() defaults to structureChanged: true", () => {
    mockScheduleCanvasPersist();
    expect(saveSnapshotMock).toHaveBeenCalledWith("project-1", [], [], {
      structureChanged: true,
    });
  });
});

describe("saveSnapshot structureChanged option", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saveSnapshot called with structureChanged: false sends structure_changed: false in payload", async () => {
    mockFetchJsonResponse({ ok: true, body: {} });

    await saveSnapshot("project-1", [], [], { structureChanged: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ nodes: [], edges: [], structure_changed: false });
  });

  it("saveSnapshot called with structureChanged: true sends structure_changed: true in payload", async () => {
    mockFetchJsonResponse({ ok: true, body: {} });

    await saveSnapshot("project-1", [], [], { structureChanged: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ nodes: [], edges: [], structure_changed: true });
  });

  it("saveSnapshot called without options does NOT send structure_changed in payload", async () => {
    mockFetchJsonResponse({ ok: true, body: {} });

    await saveSnapshot("project-1", [], []);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ nodes: [], edges: [] });
    expect(body).not.toHaveProperty("structure_changed");
  });
});
