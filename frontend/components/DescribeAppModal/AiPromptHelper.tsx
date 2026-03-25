"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";

const AI_PROMPT = `You are helping me generate AWS infrastructure using DrawToCloud.

Analyze my codebase and respond in EXACTLY this structured format. No markdown, no preamble, no commentary — only the sections below:

WHAT IT DOES
[2-3 sentences: what the application does, who uses it, and what the core user action is]

SERVICES REQUIRED
[Bullet list of backend capabilities actually present in the code: authentication, file storage, real-time updates, background jobs, email/notifications, payments, search, etc.]

DATA LAYER
[Database type (relational / document / key-value / time-series) and why. Caching needs. Approximate data volume or growth rate if inferable. Any search requirements.]

TRAFFIC CHARACTERISTICS
[Infer from code patterns: request-driven vs event-driven, peak load indicators, real-time connection counts, batch job frequency, webhook volume.]

EXTERNAL INTEGRATIONS
[Third-party APIs, webhooks, OAuth providers, payment processors, CDN requirements, media processing. List only what is present in the code.]

COMPLIANCE SIGNALS
[Any indicators of regulated data: healthcare records (HIPAA), payment data (PCI-DSS), EU users (GDPR), government systems. Write "None detected" if not applicable.]

INFRASTRUCTURE CONSTRAINTS
[Hard requirements: multi-tenancy data isolation, VPC isolation, specific AWS services already in use, queue systems, CDN, geographic distribution.]

This output feeds directly into an AI system that generates Terraform infrastructure. Vague or incomplete answers produce generic, unusable results. Be precise.`;

type Props = {
  open: boolean;
  onToggle: () => void;
};

export default function AiPromptHelper({ open, onToggle }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-gray-700">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-gray-900 px-4 py-2.5 text-left text-sm text-gray-400 transition-colors hover:bg-gray-800"
      >
        <span>Use AI to analyze your codebase</span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open ? (
        <div className="space-y-3 bg-gray-900/50 px-4 py-4">
          <p className="text-xs text-gray-500">
            Copy this prompt, paste it into your coding AI with codebase access, then paste the response in &quot;What
            are you building?&quot;
          </p>
          <div className="relative">
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-800 p-3 text-xs text-gray-300">
              {AI_PROMPT}
            </pre>
            <button
              type="button"
              onClick={handleCopy}
              className="absolute right-2 top-2 rounded bg-gray-700 p-1.5 text-gray-300 transition-colors hover:bg-gray-600"
              aria-label="Copy prompt"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
