import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESCRIBE_FORM,
  buildDescribeSubmission,
  toggleRegionSelection,
  type DescribeFormAnswers,
} from "./form";

describe("DescribeAppModal form helpers", () => {
  it("builds submission payload from required and optional fields", () => {
    const form: DescribeFormAnswers = {
      description: "  Build a scalable SaaS for invoices  ",
      expected_users: "1K-10K",
      uptime: "99.9%",
      regions: ["us-east-1", "eu-west-1"],
      monthly_budget: 800,
    };

    expect(buildDescribeSubmission(form)).toEqual({
      description: "Build a scalable SaaS for invoices",
      expected_users: "1K-10K",
      uptime: "99.9%",
      regions: ["us-east-1", "eu-west-1"],
      monthly_budget: 800,
    });
  });

  it("omits optional values when they are empty", () => {
    expect(buildDescribeSubmission(DEFAULT_DESCRIBE_FORM)).toEqual({
      description: "",
    });
  });

  it("toggles region inclusion", () => {
    expect(toggleRegionSelection([], "us-east-1")).toEqual(["us-east-1"]);
    expect(toggleRegionSelection(["us-east-1", "eu-west-1"], "us-east-1")).toEqual(["eu-west-1"]);
  });

  it("keeps at least one region selected", () => {
    expect(toggleRegionSelection(["us-east-1"], "us-east-1")).toEqual(["us-east-1"]);
  });

  it("respects the max region limit", () => {
    expect(
      toggleRegionSelection(["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"], "ap-northeast-1")
    ).toEqual(["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"]);
  });
});
