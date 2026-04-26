import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock window.confirm for template load tests
Object.defineProperty(window, "confirm", {
  writable: true,
  value: vi.fn(),
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("@/lib/useWorkspace", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/components/DescribeAppModal/useDescribeAppModal", () => ({
  useDescribeAppModal: vi.fn(() => ({ open: vi.fn() })),
}));

vi.mock("@/components/ApiKeyModal/useApiKeyModal", () => ({
  useApiKeyModal: vi.fn(() => ({ open: vi.fn() })),
}));

vi.mock("@/lib/manualLayoutPolicy", () => ({
  canApplyManualLayout: vi.fn(() => true),
}));

vi.mock("@/lib/generationUiState", () => ({
  getArchitectStatusText: vi.fn(() => null),
  isInteractionLocked: vi.fn(() => false),
}));

vi.mock("@/lib/projectActions", () => ({
  useProjectDelete: vi.fn(() => ({ deleteProject: vi.fn() })),
}));

vi.mock("@/lib/useSaveProject", () => ({
  useSaveProject: vi.fn(() => ({ save: vi.fn() })),
}));

vi.mock("@/lib/templates", () => ({
  fetchTemplateDetail: vi.fn(),
  cloneTemplate: vi.fn(),
}));

vi.mock("@/lib/projects", () => ({}));

describe("usePageState handleGenerateTerraform", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("opens generation tab when user clicks Generate Terraform", async () => {
    const openGeneration = vi.fn();
    const openOutput = vi.fn();
    const generateTerraform = vi.fn().mockResolvedValue(undefined);

    const mockWorkspaceVal = {
      user: { id: "user-1", email: "test@example.com" },
      requireAuth: vi.fn().mockReturnValue(true),
      currentProject: { id: "proj-1", share_slug: "test-project" },
      isOwner: true,
      creatingProject: false,
      rightPanelOpen: false,
      rightPanelTab: "generation" as const,
      openOutput,
      openGeneration,
      closeRightPanel: vi.fn(),
      pipeline: {
        terraformProgress: { status: "idle" },
        terraformFiles: [],
        isGenerating: false,
        chatEnabled: true,
        chatDisabledReason: null,
        pendingArchitecturePlanId: "plan-1",
        generateTerraform,
      },
    };

    (await import("@/lib/useWorkspace")).useWorkspace.mockReturnValue(mockWorkspaceVal);

    const { usePageState } = await import("../usePageState");
    const { handleGenerateTerraform } = usePageState();

    handleGenerateTerraform();

    expect(openGeneration).toHaveBeenCalledTimes(1);
    expect(openOutput).not.toHaveBeenCalled();
    expect(generateTerraform).toHaveBeenCalledTimes(1);
  });
});

describe("usePageState handleUseTemplate", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(window.confirm).mockReturnValue(true);
  });

  it("clones template and redirects to new project when user clicks Load", async () => {
    const openProject = vi.fn();
    const loadTemplateSnapshot = vi.fn();

    const mockWorkspaceVal = {
      user: { id: "user-1", email: "test@example.com" },
      requireAuth: vi.fn().mockReturnValue(true),
      currentProject: null,
      isOwner: true,
      creatingProject: false,
      rightPanelOpen: false,
      rightPanelTab: "generation" as const,
      openProject,
      closeRightPanel: vi.fn(),
      pipeline: {
        nodes: [],
        terraformProgress: { status: "idle" },
        terraformFiles: [],
        isGenerating: false,
        chatEnabled: true,
        chatDisabledReason: null,
        pendingArchitecturePlanId: null,
        loadTemplateSnapshot,
      },
    };

    (await import("@/lib/useWorkspace")).useWorkspace.mockReturnValue(mockWorkspaceVal);

    const { cloneTemplate } = await import("@/lib/templates");
    (cloneTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({ share_slug: "cloned-proj-123" });

    const { usePageState } = await import("../usePageState");
    const { handleUseTemplate } = usePageState();

    await handleUseTemplate("my-template");

    expect(cloneTemplate).toHaveBeenCalledTimes(1);
    expect(cloneTemplate).toHaveBeenCalledWith("my-template");
    expect(openProject).toHaveBeenCalledTimes(1);
    expect(openProject).toHaveBeenCalledWith("cloned-proj-123");
    expect(loadTemplateSnapshot).not.toHaveBeenCalled();
  });

  it("requires authentication before cloning a template", async () => {
    const requireAuth = vi.fn().mockReturnValue(false);
    const openProject = vi.fn();

    const mockWorkspaceVal = {
      user: null,
      requireAuth,
      currentProject: null,
      isOwner: false,
      creatingProject: false,
      rightPanelOpen: false,
      rightPanelTab: "generation" as const,
      openProject,
      closeRightPanel: vi.fn(),
      pipeline: {
        nodes: [],
        terraformProgress: { status: "idle" },
        terraformFiles: [],
        isGenerating: false,
        chatEnabled: true,
        chatDisabledReason: null,
        pendingArchitecturePlanId: null,
        loadTemplateSnapshot: vi.fn(),
      },
    };

    (await import("@/lib/useWorkspace")).useWorkspace.mockReturnValue(mockWorkspaceVal);

    const { cloneTemplate } = await import("@/lib/templates");
    const cloneTemplateMock = vi.mocked(cloneTemplate);

    const { usePageState } = await import("../usePageState");
    const { handleUseTemplate } = usePageState();

    await handleUseTemplate("my-template");

    expect(requireAuth).toHaveBeenCalledTimes(1);
    expect(cloneTemplateMock).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("does not clone when the user cancels replacing their current design", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const openProject = vi.fn();

    const mockWorkspaceVal = {
      user: { id: "user-1", email: "test@example.com" },
      requireAuth: vi.fn().mockReturnValue(true),
      currentProject: null,
      isOwner: true,
      creatingProject: false,
      rightPanelOpen: false,
      rightPanelTab: "generation" as const,
      openProject,
      closeRightPanel: vi.fn(),
      pipeline: {
        nodes: [{ id: "vpc" }],
        terraformProgress: { status: "idle" },
        terraformFiles: [],
        isGenerating: false,
        chatEnabled: true,
        chatDisabledReason: null,
        pendingArchitecturePlanId: null,
        loadTemplateSnapshot: vi.fn(),
      },
    };

    (await import("@/lib/useWorkspace")).useWorkspace.mockReturnValue(mockWorkspaceVal);

    const { cloneTemplate } = await import("@/lib/templates");
    const cloneTemplateMock = vi.mocked(cloneTemplate);

    const { usePageState } = await import("../usePageState");
    const { handleUseTemplate } = usePageState();

    await handleUseTemplate("my-template");

    expect(window.confirm).toHaveBeenCalledWith(
      "Leave current design and open a new project cloned from this template?"
    );
    expect(cloneTemplateMock).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
  });
});
