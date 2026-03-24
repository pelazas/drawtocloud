import type { Node } from "reactflow";

export type NodeCost = {
  nodeId: string;
  label: string;
  cost: number;
};

export type CostBreakdown = {
  monthly_total: number;
  items: NodeCost[];
};

const PRICING: Array<{ keyword: string; cost: number }> = [
  { keyword: "ec2", cost: 50 },
  { keyword: "ecs", cost: 50 },
  { keyword: "lambda", cost: 5 },
  { keyword: "alb", cost: 20 },
  { keyword: "load balancer", cost: 20 },
  { keyword: "rds", cost: 80 },
  { keyword: "dynamodb", cost: 25 },
  { keyword: "elasticache", cost: 40 },
  { keyword: "redis", cost: 40 },
  { keyword: "s3", cost: 5 },
  { keyword: "efs", cost: 10 },
  { keyword: "cloudfront", cost: 10 },
  { keyword: "waf", cost: 15 },
  { keyword: "cloudwatch", cost: 10 },
  { keyword: "sns", cost: 5 },
  { keyword: "sqs", cost: 5 },
  { keyword: "api gateway", cost: 15 },
  { keyword: "nat gateway", cost: 35 },
  { keyword: "route 53", cost: 5 },
  { keyword: "route53", cost: 5 },
];

const CATEGORY_DEFAULTS: Record<string, number> = {
  compute: 30,
  database: 40,
  storage: 5,
  network: 0,
  security: 10,
  monitoring: 10,
};

function nodeCost(label: string, category: string): number {
  const lowerLabel = label.toLowerCase();
  for (const entry of PRICING) {
    if (lowerLabel.includes(entry.keyword)) return entry.cost;
  }
  return CATEGORY_DEFAULTS[category] ?? 0;
}

export function estimateCost(nodes: Node[]): CostBreakdown {
  const items: NodeCost[] = [];

  for (const node of nodes) {
    const label = typeof node.data?.label === "string" ? node.data.label : "";
    const category = typeof node.data?.category === "string" ? node.data.category : "";
    const cost = nodeCost(label, category);
    if (cost > 0) {
      items.push({
        nodeId: node.id,
        label,
        cost,
      });
    }
  }

  return {
    monthly_total: items.reduce((sum, item) => sum + item.cost, 0),
    items,
  };
}
