"use client";

import { useState } from "react";
import { CalendarDays, DollarSign, FolderKanban, Key, Network, Plus, Settings } from "lucide-react";
import UserMenu from "@/components/UserMenu";
import { ProjectSummary } from "@/lib/projects";

type Props = {
  projects: ProjectSummary[];
  remainingGenerations: number;
  generationLimit: number;
  quotaLoading: boolean;
  hasApiKey?: boolean;
  isAdmin?: boolean;
  onOpenSettings: () => void;
  onOpenProject: (projectId: string) => void;
  onNewGeneration: () => void;
  navigationError?: string | null;
};

function formatCreatedDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatMonthlyCost(value: number | null): string {
  if (value === null) return "Cost not available";
  return `$${value.toFixed(2)}/mo`;
}

export default function ProjectsDashboard({
  projects,
  remainingGenerations,
  generationLimit,
  quotaLoading,
  hasApiKey = false,
  isAdmin = false,
  onOpenSettings,
  onOpenProject,
  onNewGeneration,
  navigationError = null,
}: Props) {
  const [showQuotaPrompt, setShowQuotaPrompt] = useState(false);

  const quotaLabel = quotaLoading
    ? "Checking quota..."
    : isAdmin
      ? "Unlimited generations"
      : `${remainingGenerations}/${generationLimit} generations remaining`;

  function handleNewGeneration() {
    if (!isAdmin && remainingGenerations === 0 && !hasApiKey) {
      setShowQuotaPrompt(true);
      return;
    }

    setShowQuotaPrompt(false);
    onNewGeneration();
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Your Projects</h1>
            <p className="text-sm text-gray-400">Pick up where you left off or start a new generation.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-lg border border-gray-700 bg-gray-800 p-2 text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
              title="AI Provider Settings"
              aria-label="AI Provider Settings"
            >
              <Settings size={16} />
            </button>
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
              {quotaLabel}
            </div>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {navigationError && (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {navigationError}
          </div>
        )}
        {showQuotaPrompt && (
          <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-4">
            <p className="mb-2 text-sm text-amber-200">
              You have used all your free generations. Add your own API key for unlimited generations.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowQuotaPrompt(false);
                onOpenSettings();
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500"
            >
              <Key size={14} />
              Add API Key
            </button>
          </div>
        )}
        <div className="mb-8 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-gray-400">Generation History</h2>
          <button
            type="button"
            onClick={handleNewGeneration}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            <Plus size={16} />
            New Generation
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 px-8 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 text-blue-300">
              <FolderKanban size={26} />
            </div>
            <h3 className="text-xl font-semibold">No projects yet. Create your first architecture!</h3>
            <p className="mt-2 text-sm text-gray-400">Start with the questionnaire and generate your first cloud diagram.</p>
            <button
              type="button"
              onClick={handleNewGeneration}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              <Plus size={16} />
              New Generation
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onOpenProject(project.id)}
                className="text-left rounded-2xl border border-gray-800 bg-gray-900/70 p-4 hover:border-blue-500/40 hover:bg-gray-900 transition-colors"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-300">
                    <FolderKanban size={18} />
                  </div>
                  <span className="rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-300">Open</span>
                </div>

                <h3 className="min-h-[2.5rem] text-base font-semibold text-white">{project.title}</h3>

                <div className="mt-4 space-y-2 text-xs text-gray-400">
                  <p className="flex items-center gap-2">
                    <CalendarDays size={13} />
                    {formatCreatedDate(project.createdAt)}
                  </p>
                  <p className="flex items-center gap-2">
                    <DollarSign size={13} />
                    {formatMonthlyCost(project.monthlyCost)}
                  </p>
                  <p className="flex items-center gap-2">
                    <Network size={13} />
                    {project.nodeCount} services
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
