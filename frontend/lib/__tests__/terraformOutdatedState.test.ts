import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSnapshot } from "../projectApi";

const getSessionMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getSession: getSessionMock },
  }),
}));

function mockFetchJsonResponse({ ok, body = {} }: { ok: boolean; body?: unknown }) {
  fetchMock.mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("saveSnapshot structureChanged option", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
    });
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
