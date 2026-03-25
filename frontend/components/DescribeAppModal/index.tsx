"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import AiPromptHelper from "./AiPromptHelper";
import ExpectedUsersCards from "./ExpectedUsersCards";
import { buildDescribeSubmission } from "./form";
import RegionSelector from "./RegionSelector";
import UptimeCards from "./UptimeCards";
import type { useDescribeAppModal } from "./useDescribeAppModal";

type Props = ReturnType<typeof useDescribeAppModal> & {
  onSubmit: (answers: Record<string, string | string[] | number>) => void;
  isSubmitting?: boolean;
};

export default function DescribeAppModal({
  isOpen,
  form,
  close,
  setField,
  canSubmit,
  onSubmit,
  isSubmitting = false,
}: Props) {
  const [aiHelperOpen, setAiHelperOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAiHelperOpen(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleSubmit() {
    if (!canSubmit || isSubmitting) return;
    onSubmit(buildDescribeSubmission(form));
    close();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Describe your app</h2>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={isSubmitting}
            className="text-gray-400 transition-colors hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto pr-1">
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">What are you building?</label>
            <textarea
              value={form.description}
              onChange={(event) => setField("description", event.target.value)}
              placeholder="Describe your application, its purpose, and key requirements..."
              rows={4}
              className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <AiPromptHelper open={aiHelperOpen} onToggle={() => setAiHelperOpen((prev) => !prev)} />
          </div>

          <ExpectedUsersCards
            value={form.expected_users}
            onChange={(next) => setField("expected_users", next)}
          />

          <UptimeCards value={form.uptime} onChange={(next) => setField("uptime", next)} />

          <RegionSelector regions={form.regions} onChange={(next) => setField("regions", next)} />

          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Monthly budget (USD)</label>
            <input
              type="number"
              min={0}
              value={form.monthly_budget || ""}
              onChange={(event) => setField("monthly_budget", Number(event.target.value) || 0)}
              placeholder="e.g. 500"
              className="w-full max-w-[220px] rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={close}
            disabled={isSubmitting}
            className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles size={14} />
            Generate Architecture
          </button>
        </div>
      </div>
    </div>
  );
}
