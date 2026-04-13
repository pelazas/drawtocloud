import { describe, expect, it, vi, beforeEach } from "vitest";

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
