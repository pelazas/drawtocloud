import { describe, expect, it } from "vitest";
import { mapProjectRow } from "../projects";

describe("mapProjectRow project mode parsing", () => {
  it("maps explicit discovery mode from backend", () => {
    const project = mapProjectRow({
      id: "project-1",
      title: "Discovery project",
      project_mode: "discovery",
      questionnaire_answers: {
        app_name: "Discovery App",
      },
    });

    expect(project).not.toBeNull();
    expect(project?.projectMode).toBe("discovery");
  });

  it("defaults to discovery when legacy questionnaire marks chat first", () => {
    const project = mapProjectRow({
      id: "project-2",
      questionnaire_answers: {
        app_name: "Legacy Discovery App",
        _mode: "chat_first",
      },
    });

    expect(project).not.toBeNull();
    expect(project?.projectMode).toBe("discovery");
  });

  it("falls back to default mode when backend value is unknown", () => {
    const project = mapProjectRow({
      id: "project-3",
      project_mode: "something_else",
      questionnaire_answers: {
        app_name: "Default App",
      },
    });

    expect(project).not.toBeNull();
    expect(project?.projectMode).toBe("default");
  });
});
