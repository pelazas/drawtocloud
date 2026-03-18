"use client";

import { Plus, Settings } from "lucide-react";
import UserMenu from "@/components/UserMenu";
import type { ProjectSummary } from "@/lib/projects";
import DeleteProjectDialog from "./DeleteProjectDialog";
import EmptyState from "./EmptyState";
import ProjectCard from "./ProjectCard";

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
  onDeleteProject: (id: string) => void;
  pendingDeleteId: string | null;
  isDeleting: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  navigationError?: string | null;
};

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
  onDeleteProject,
  pendingDeleteId,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
  navigationError = null,
}: Props) {
  const quotaLabel = quotaLoading
    ? "Checking quota..."
    : isAdmin
      ? "Unlimited generations"
      : `${remainingGenerations}/${generationLimit} generations remaining`;
  const isQuotaExhausted = !isAdmin && !hasApiKey && !quotaLoading && remainingGenerations === 0;
  const quotaExhaustedLabel = isQuotaExhausted ? "No remaining quota" : null;

  function handleNewGeneration() {
    if (isQuotaExhausted) return;
    onNewGeneration();
  }
  const pendingDeleteTitle = pendingDeleteId
    ? projects.find((p) => p.id === pendingDeleteId)?.title ?? "this project"
    : "";
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
        <div className="mb-8 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-gray-400">Generation History</h2>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={handleNewGeneration}
              disabled={isQuotaExhausted}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} />
              New Generation
            </button>
            {quotaExhaustedLabel && <p className="text-xs text-amber-300">{quotaExhaustedLabel}</p>}
          </div>
        </div>

        {projects.length === 0 ? (
          <EmptyState
            onNewGeneration={handleNewGeneration}
            isNewGenerationDisabled={isQuotaExhausted}
            disabledLabel={quotaExhaustedLabel}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={onOpenProject}
                onDelete={onDeleteProject}
              />
            ))}
          </div>
        )}
      </main>

      <DeleteProjectDialog
        open={pendingDeleteId !== null}
        projectTitle={pendingDeleteTitle}
        isDeleting={isDeleting}
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />
    </div>
  );
}
