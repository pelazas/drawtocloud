"use client";

import { useState } from "react";
import { detectRecommendedRegions, detectTimezone } from "@/lib/regionDetect";

export const UPTIME_OPTIONS = ["99.0% SLA", "99.9% SLA", "99.99% SLA"];
export const COMPLIANCE_OPTIONS = ["None", "GDPR", "HIPAA", "PCI-DSS", "SOC 2"];
export const ENVIRONMENT_OPTIONS = ["Development", "Staging", "Production"];
export const COMPUTE_OPTIONS = ["No preference", "Serverless (Lambda)", "Containers (ECS/EKS)", "VMs (EC2)"];

export const EXPECTED_USERS_CARDS = [
  {
    label: "MVP / Just exploring",
    description: "Perfect for testing an idea, internal tools, or side projects with a minimal footprint.",
    value: "<1K/mo",
  },
  {
    label: "Early Traction",
    description: "For growing apps with consistent early users needing reliable performance.",
    value: "1K–100K/mo",
  },
  {
    label: "Growing Business",
    description: "For scaling platforms expecting steady daily traffic and needing higher capacity.",
    value: "100K–1M/mo",
  },
  {
    label: "Enterprise Scale",
    description: "For high-volume, mission-critical applications requiring maximum concurrent load.",
    value: "1M+/mo",
  },
] as const;

export const UPTIME_CARDS = [
  { label: "Standard", value: "99.0% SLA", subtitle: "Up to ~7h downtime/month" },
  { label: "High Availability", value: "99.9% SLA", subtitle: "Up to ~43min downtime/month", recommended: true },
  { label: "Mission Critical", value: "99.99% SLA", subtitle: "Up to ~4min downtime/month" },
] as const;

export type PreGenAnswers = {
  app_name: string;
  description?: string;
  regions: string[];
  expected_users: string;
  uptime: string;
  compliance?: string;
  environment?: string;
  compute_preference?: string;
  monthly_budget?: number;
};

export type UsePreGenFormResult = {
  appName: string;
  setAppName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  regions: string[];
  setRegions: (v: string[]) => void;
  toggleRegion: (region: string) => void;
  expectedUsers: string;
  setExpectedUsers: (v: string) => void;
  uptime: string;
  setUptime: (v: string) => void;
  monthlyBudget: string;
  setMonthlyBudget: (v: string) => void;
  budgetError: string | null;
  compliance: string;
  setCompliance: (v: string) => void;
  environment: string;
  setEnvironment: (v: string) => void;
  computePreference: string;
  setComputePreference: (v: string) => void;
  advancedOpen: boolean;
  setAdvancedOpen: (v: boolean) => void;
  aiHelperOpen: boolean;
  setAiHelperOpen: (v: boolean) => void;
  isFastPath: boolean;
  isValid: boolean;
  buildAnswers: () => PreGenAnswers;
};

export function usePreGenForm(): UsePreGenFormResult {
  const [appName, setAppName] = useState("");
  const [description, setDescription] = useState("");
  const [regions, setRegions] = useState<string[]>(() => {
    const timezone = detectTimezone();
    const recommended = detectRecommendedRegions(timezone);
    return [recommended[0]];
  });
  const [expectedUsers, setExpectedUsers] = useState("1K–100K/mo");
  const [uptime, setUptime] = useState("99.9% SLA");
  const [monthlyBudget, setMonthlyBudget] = useState("");
  const [compliance, setCompliance] = useState("None");
  const [environment, setEnvironment] = useState("Production");
  const [computePreference, setComputePreference] = useState("No preference");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [aiHelperOpen, setAiHelperOpen] = useState(false);

  const isFastPath = description.trim().length > 0;
  const budgetValue = Number(monthlyBudget);
  const budgetError = monthlyBudget !== "" && (Number.isNaN(budgetValue) || budgetValue < 5)
    ? "Minimum budget is $5/month"
    : null;
  const isValid = appName.trim().length > 0 && budgetError === null;
  const MAX_REGIONS = 5;

  function toggleRegion(region: string) {
    setRegions((prev) => {
      if (prev.includes(region)) {
        return prev.length > 1 ? prev.filter((value) => value !== region) : prev;
      }
      if (prev.length >= MAX_REGIONS) return prev;
      return [...prev, region];
    });
  }

  function buildAnswers(): PreGenAnswers {
    const answers: PreGenAnswers = {
      app_name: appName.trim(),
      regions,
      expected_users: expectedUsers,
      uptime,
    };
    if (isFastPath) answers.description = description.trim();
    if (compliance !== "None") answers.compliance = compliance;
    if (environment !== "Production") answers.environment = environment;
    if (computePreference !== "No preference") answers.compute_preference = computePreference;
    if (monthlyBudget !== "" && !Number.isNaN(budgetValue) && budgetValue >= 5) {
      answers.monthly_budget = budgetValue;
    }
    return answers;
  }

  return {
    appName, setAppName,
    description, setDescription,
    regions, setRegions, toggleRegion,
    expectedUsers, setExpectedUsers,
    uptime, setUptime,
    monthlyBudget, setMonthlyBudget, budgetError,
    compliance, setCompliance,
    environment, setEnvironment,
    computePreference, setComputePreference,
    advancedOpen, setAdvancedOpen,
    aiHelperOpen, setAiHelperOpen,
    isFastPath,
    isValid,
    buildAnswers,
  };
}
