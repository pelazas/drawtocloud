"use client";

import { useState } from "react";

export const REGION_OPTIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1", "ap-northeast-1"];
export const EXPECTED_USERS_OPTIONS = ["<1K/mo", "1K–100K/mo", "100K–1M/mo", "1M+/mo"];
export const UPTIME_OPTIONS = ["Best effort", "99.9% SLA", "99.99% SLA"];
export const COMPLIANCE_OPTIONS = ["None", "GDPR", "HIPAA", "PCI-DSS", "SOC 2"];
export const ENVIRONMENT_OPTIONS = ["Development", "Staging", "Production"];
export const COMPUTE_OPTIONS = ["No preference", "Serverless (Lambda)", "Containers (ECS/EKS)", "VMs (EC2)"];

export type PreGenAnswers = {
  app_name: string;
  description?: string;
  region: string;
  expected_users: string;
  uptime: string;
  compliance?: string;
  environment?: string;
  compute_preference?: string;
};

export type UsePreGenFormResult = {
  appName: string;
  setAppName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  region: string;
  setRegion: (v: string) => void;
  expectedUsers: string;
  setExpectedUsers: (v: string) => void;
  uptime: string;
  setUptime: (v: string) => void;
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
  const [region, setRegion] = useState("us-east-1");
  const [expectedUsers, setExpectedUsers] = useState("1K–100K/mo");
  const [uptime, setUptime] = useState("99.9% SLA");
  const [compliance, setCompliance] = useState("None");
  const [environment, setEnvironment] = useState("Production");
  const [computePreference, setComputePreference] = useState("No preference");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [aiHelperOpen, setAiHelperOpen] = useState(false);

  const isFastPath = description.trim().length > 0;
  const isValid = appName.trim().length > 0;

  function buildAnswers(): PreGenAnswers {
    const answers: PreGenAnswers = {
      app_name: appName.trim(),
      region,
      expected_users: expectedUsers,
      uptime,
    };
    if (isFastPath) answers.description = description.trim();
    if (compliance !== "None") answers.compliance = compliance;
    if (environment !== "Production") answers.environment = environment;
    if (computePreference !== "No preference") answers.compute_preference = computePreference;
    return answers;
  }

  return {
    appName, setAppName,
    description, setDescription,
    region, setRegion,
    expectedUsers, setExpectedUsers,
    uptime, setUptime,
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
