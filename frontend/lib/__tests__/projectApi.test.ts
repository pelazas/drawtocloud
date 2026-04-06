import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, renameProject, saveSnapshot } from "../projectApi";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

const fetchMock = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: getSessionMock,
    },
  }),
}));

function mockFetchJsonResponse({
  ok,
  status = 200,
  body = {},
  rejectJson = false,
}: {
  ok: boolean;
  status?: number;
  body?: unknown;
  rejectJson?: boolean;
}) {
  const json = rejectJson
    ? vi.fn().mockRejectedValue(new Error("Invalid JSON"))
    : vi.fn().mockResolvedValue(body);

  fetchMock.mockResolvedValue({
    ok,
    status,
    json,
  });
}

describe("projectApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: "token-123",
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createProject posts name and returns project identifiers", async () => {
    mockFetchJsonResponse({
      ok: true,
      body: {
        project_id: "project-1",
        share_slug: "share-1",
      },
    });

    await expect(createProject("New project")).resolves.toEqual({
      project_id: "project-1",
      share_slug: "share-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects");
    expect(url).toMatch(/\/api\/projects$/);
    expect(options).toEqual({
      method: "POST",
      headers: {
        Authorization: "Bearer token-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "New project" }),
    });
  });

  it("createProject trims project_id and share_slug on success", async () => {
    mockFetchJsonResponse({
      ok: true,
      body: {
        project_id: "  project-1  ",
        share_slug: "  share-1  ",
      },
    });

    await expect(createProject("New project")).resolves.toEqual({
      project_id: "project-1",
      share_slug: "share-1",
    });
  });

  it("createProject throws backend message on non-ok response", async () => {
    mockFetchJsonResponse({
      ok: false,
      status: 400,
      body: {
        detail: {
          message: "Project name already exists.",
        },
      },
    });

    await expect(createProject("Duplicate")).rejects.toThrow("Project name already exists.");
  });

  it("createProject falls back to default message when non-ok body is null", async () => {
    mockFetchJsonResponse({
      ok: false,
      status: 500,
      body: null,
    });

    await expect(createProject("Bad body")).rejects.toThrow("Request failed");
  });

  it("createProject supports detail as a plain string on non-ok response", async () => {
    mockFetchJsonResponse({
      ok: false,
      status: 400,
      body: {
        detail: "Name cannot be empty.",
      },
    });

    await expect(createProject("")).rejects.toThrow("Name cannot be empty.");
  });

  it("createProject throws when response shape is invalid", async () => {
    mockFetchJsonResponse({
      ok: true,
      body: {
        project_id: "project-1",
        share_slug: "",
      },
    });

    await expect(createProject("Invalid response")).rejects.toThrow("Invalid create project response");
  });

  it("createProject throws when access token is missing", async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: null,
      },
    });

    await expect(createProject("No token")).rejects.toThrow("Missing access token. Please sign in again.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saveSnapshot patches nodes and edges", async () => {
    mockFetchJsonResponse({
      ok: true,
      body: {},
    });

    const nodes = [{ id: "node-1" }];
    const edges = [{ id: "edge-1" }];

    await expect(saveSnapshot("project/id with spaces", nodes, edges)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects/project%2Fid%20with%20spaces/snapshot");
    expect(options).toEqual({
      method: "PATCH",
      headers: {
        Authorization: "Bearer token-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nodes, edges }),
    });
  });

  it("saveSnapshot throws backend detail error on non-ok response", async () => {
    mockFetchJsonResponse({
      ok: false,
      status: 422,
      body: {
        detail: {
          error: "Snapshot payload rejected.",
        },
      },
    });

    await expect(saveSnapshot("project-1", [], [])).rejects.toThrow("Snapshot payload rejected.");
  });

  it("saveSnapshot falls back to default message when non-ok body is a primitive", async () => {
    mockFetchJsonResponse({
      ok: false,
      status: 500,
      body: "oops",
    });

    await expect(saveSnapshot("project-1", [], [])).rejects.toThrow("Request failed");
  });

  it("saveSnapshot supports detail arrays of strings on non-ok response", async () => {
    mockFetchJsonResponse({
      ok: false,
      status: 400,
      body: {
        detail: ["nodes invalid", "edges invalid"],
      },
    });

    await expect(saveSnapshot("project-1", [], [])).rejects.toThrow("nodes invalid, edges invalid");
  });

  it("saveSnapshot falls back to default message when response JSON is invalid", async () => {
    mockFetchJsonResponse({
      ok: false,
      status: 500,
      rejectJson: true,
    });

    await expect(saveSnapshot("project-1", [], [])).rejects.toThrow("Request failed");
  });

  it("saveSnapshot throws when access token is missing", async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: null,
      },
    });

    await expect(saveSnapshot("project-1", [], [])).rejects.toThrow("Missing access token. Please sign in again.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renameProject patches title", async () => {
    mockFetchJsonResponse({
      ok: true,
      body: { ok: true },
    });

    await expect(renameProject("project/id with spaces", "Renamed Project")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects/project%2Fid%20with%20spaces");
    expect(options).toEqual({
      method: "PATCH",
      headers: {
        Authorization: "Bearer token-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Renamed Project" }),
    });
  });

  it("renameProject throws backend detail error on non-ok response", async () => {
    mockFetchJsonResponse({
      ok: false,
      status: 400,
      body: {
        detail: {
          error: "Project rename failed.",
        },
      },
    });

    await expect(renameProject("project-1", "Renamed")).rejects.toThrow("Project rename failed.");
  });

  it("renameProject throws when access token is missing", async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: null,
      },
    });

    await expect(renameProject("project-1", "Renamed")).rejects.toThrow("Missing access token. Please sign in again.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
