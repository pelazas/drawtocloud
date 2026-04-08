import { describe, expect, it } from "vitest";
import { clearTransientChatErrorStatus } from "../chatPipelineStatus";

describe("clearTransientChatErrorStatus", () => {
  it("clears error-prefixed status strings", () => {
    expect(clearTransientChatErrorStatus("Error: Connection lost. Try again later."))
      .toBeNull();
  });

  it("keeps non-error statuses unchanged", () => {
    expect(clearTransientChatErrorStatus("Running: architect")).toBe("Running: architect");
    expect(clearTransientChatErrorStatus(null)).toBeNull();
  });
});
