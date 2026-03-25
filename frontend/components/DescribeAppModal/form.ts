export type DescribeFormAnswers = {
  description: string;
  expected_users: string;
  uptime: string;
  regions: string[];
  monthly_budget: number;
};

export const MAX_SELECTED_REGIONS = 5;

export const EXPECTED_USERS_CARDS = [
  {
    title: "MVP / Just exploring",
    description: "Perfect for testing an idea",
    expectedUsers: "<1K/mo",
    value: "<1K/mo",
  },
  {
    title: "Early traction",
    description: "For growing apps",
    expectedUsers: "1k-100k/mo",
    value: "1k-100k/mo",
  },
  {
    title: "Growing Business",
    description: "For scaling platforms",
    expectedUsers: "100k-1M/mo",
    value: "100k-1M/mo",
  },
  {
    title: "Enterprise Scale",
    description: "For high volume",
    expectedUsers: "1M+/mo",
    value: "1M+/mo",
  },
] as const;

export const UPTIME_CARDS = [
  {
    title: "Standard",
    downtime: "Up to -7h downtime/month",
    sla: "99.0% SLA",
    value: "99.0% SLA",
  },
  {
    title: "High availability",
    downtime: "Up to -43 min downtime/month",
    sla: "99.9% SLA",
    value: "99.9% SLA",
  },
  {
    title: "Mission critical",
    downtime: "Up to -4min downtime/month",
    sla: "99.99% SLA",
    value: "99.99% SLA",
  },
] as const;

export const DEFAULT_DESCRIBE_FORM: DescribeFormAnswers = {
  description: "",
  expected_users: "",
  uptime: "",
  regions: [],
  monthly_budget: 0,
};

export function buildDescribeSubmission(form: DescribeFormAnswers): Record<string, string | string[] | number> {
  const answers: Record<string, string | string[] | number> = {
    description: form.description.trim(),
  };

  if (form.expected_users) answers.expected_users = form.expected_users;
  if (form.uptime) answers.uptime = form.uptime;
  if (form.regions.length > 0) answers.regions = form.regions;
  if (form.monthly_budget > 0) answers.monthly_budget = form.monthly_budget;

  return answers;
}

export function toggleRegionSelection(current: string[], region: string): string[] {
  if (current.includes(region)) {
    return current.length > 1 ? current.filter((entry) => entry !== region) : current;
  }

  if (current.length >= MAX_SELECTED_REGIONS) {
    return current;
  }

  return [...current, region];
}
