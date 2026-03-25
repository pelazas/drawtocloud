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

  it("maps selected node chips from chat history metadata", () => {
    const project = mapProjectRow({
      id: "project-4",
      project_mode: "default",
      chat_history: [
        {
          role: "user",
          content: "Can you optimize this?",
          selected_nodes: [
            { id: "alb", label: "ALB", category: "network" },
            { id: "rds", label: "RDS", category: "database" },
          ],
        },
      ],
      questionnaire_answers: {
        app_name: "Default App",
      },
    });

    expect(project).not.toBeNull();
    expect(project?.chatHistory).toHaveLength(1);
    expect(project?.chatHistory[0].selectedNodes).toEqual([
      { id: "alb", label: "ALB", category: "network" },
      { id: "rds", label: "RDS", category: "database" },
    ]);
  });
});
