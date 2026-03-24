import type { Node } from "reactflow";
import { describe, expect, it } from "vitest";
import { estimateCost } from "../costEstimator";

function makeNode(id: string, label: string, category: string): Node {
  return {
    id,
    type: "service",
    position: { x: 0, y: 0 },
    data: { label, category },
  };
}

describe("estimateCost", () => {
  it("returns 0 for empty nodes", () => {
    const result = estimateCost([]);

    expect(result.monthly_total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("matches EC2 keyword", () => {
    const result = estimateCost([makeNode("ec2", "EC2 Instance", "compute")]);

    expect(result.monthly_total).toBe(50);
    expect(result.items).toEqual([{ nodeId: "ec2", label: "EC2 Instance", cost: 50 }]);
  });

  it("matches keyword case-insensitively", () => {
    const result = estimateCost([makeNode("db", "RDS PostgreSQL", "database")]);

    expect(result.monthly_total).toBe(80);
  });

  it("falls back to category defaults", () => {
    const result = estimateCost([makeNode("custom", "Custom Compute", "compute")]);

    expect(result.monthly_total).toBe(30);
  });

  it("excludes nodes with $0 estimate", () => {
    const result = estimateCost([makeNode("vpc", "VPC", "network")]);

    expect(result.monthly_total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("sums multiple nodes", () => {
    const result = estimateCost([
      makeNode("ec2", "EC2", "compute"),
      makeNode("rds", "RDS MySQL", "database"),
      makeNode("s3", "S3 Bucket", "storage"),
    ]);

    expect(result.monthly_total).toBe(135);
    expect(result.items).toHaveLength(3);
  });

  it("uses first keyword match when multiple match", () => {
    const result = estimateCost([makeNode("lb", "ALB Load Balancer", "network")]);

    expect(result.monthly_total).toBe(20);
  });
});
