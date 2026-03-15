"use client";

import Link from "next/link";
import AdvancedOptions from "./AdvancedOptions";
import AiPromptHelper from "./AiPromptHelper";
import OperationalSelectors from "./OperationalSelectors";
import { type PreGenAnswers, usePreGenForm } from "./usePreGenForm";

const BG_STYLE = {
  background: "radial-gradient(ellipse at 50% 0%, rgb(15 23 42) 0%, rgb(2 4 12) 70%)",
};

interface PreGenFormProps {
  onSubmit: (answers: PreGenAnswers, mode: "fast_path" | "chat_first") => void;
  remainingGenerations: number;
  generationLimit: number;
  quotaLoading: boolean;
  isAdmin?: boolean;
  quotaExhaustedMessage: string;
}

export default function PreGenForm({
  onSubmit,
  remainingGenerations,
  generationLimit,
  quotaLoading,
  isAdmin = false,
  quotaExhaustedMessage,
}: PreGenFormProps) {
  const form = usePreGenForm();
  const isQuotaExhausted = !isAdmin && !quotaLoading && remainingGenerations <= 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.isValid || isQuotaExhausted) return;
    onSubmit(form.buildAnswers(), form.isFastPath ? "fast_path" : "chat_first");
  }

  const quotaLabel = quotaLoading
    ? "…"
    : isAdmin
    ? "Unlimited generations"
    : isQuotaExhausted
    ? quotaExhaustedMessage
    : `${remainingGenerations} / ${generationLimit} remaining`;

  return (
    <div className="min-h-screen text-white" style={BG_STYLE}>
      <div className="fixed right-6 top-4 z-[70]">
        <Link
          href="/"
          className="inline-flex items-center rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>

      <main className="flex min-h-screen items-center justify-center px-4 py-16">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-white">New Architecture</h1>
            <p className="text-sm text-gray-400 mt-1">{quotaLabel}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Project name *</label>
              <input
                type="text"
                value={form.appName}
                onChange={(e) => form.setAppName(e.target.value)}
                placeholder="e.g. MyApp"
                required
                className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:border-blue-500 placeholder-gray-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Describe your app{" "}
                <span className="text-gray-600">(optional — leave empty for AI-guided design)</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => form.setDescription(e.target.value)}
                placeholder="e.g. A SaaS analytics platform with real-time dashboards, user auth, and file uploads…"
                rows={3}
                className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:border-blue-500 placeholder-gray-500 resize-none"
              />
              <AiPromptHelper
                open={form.aiHelperOpen}
                onToggle={() => form.setAiHelperOpen(!form.aiHelperOpen)}
                onApply={form.setDescription}
              />
            </div>

            <OperationalSelectors
              region={form.region}
              onRegionChange={form.setRegion}
              expectedUsers={form.expectedUsers}
              onExpectedUsersChange={form.setExpectedUsers}
              uptime={form.uptime}
              onUptimeChange={form.setUptime}
            />

            <AdvancedOptions
              open={form.advancedOpen}
              onToggle={() => form.setAdvancedOpen(!form.advancedOpen)}
              compliance={form.compliance}
              onComplianceChange={form.setCompliance}
              environment={form.environment}
              onEnvironmentChange={form.setEnvironment}
              computePreference={form.computePreference}
              onComputePreferenceChange={form.setComputePreference}
            />

            <button
              type="submit"
              disabled={!form.isValid || isQuotaExhausted}
              className="w-full py-3 rounded-xl text-lg font-semibold transition-all bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-lg shadow-blue-900/30"
            >
              {form.isFastPath ? "Generate Architecture" : "Start Designing"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
