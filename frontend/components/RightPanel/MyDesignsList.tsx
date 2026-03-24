"use client";

import { Trash2 } from "lucide-react";
import type { ProjectSummary } from "@/lib/projects";

interface MyDesignsListProps {
  projects: ProjectSummary[];
  loading: boolean;
  onOpen: (slug: string) => void;
  onDelete: (id: string) => void;
  pendingDeleteId: string | null;
  isDeleting: boolean;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete: () => void;
}

export default function MyDesignsList({
  projects,
  loading,
  onOpen,
  onDelete,
  pendingDeleteId,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
}: MyDesignsListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-gray-400">No designs yet</p>
        <p className="text-xs text-gray-500 mt-1">Create a project to see it here.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {projects.map((project) => (
        <div key={project.id} className="border-b border-gray-800">
          {pendingDeleteId === project.id ? (
            <div className="px-4 py-3 bg-red-950/30">
              <p className="text-xs text-red-300 mb-2">Delete this project?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void onConfirmDelete()}
                  disabled={isDeleting}
                  className="px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white transition-colors"
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
                <button
                  type="button"
                  onClick={onCancelDelete}
                  disabled={isDeleting}
                  className="px-3 py-1 text-xs rounded border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 hover:bg-gray-800/50 transition-colors group">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (project.shareSlug) {
                      onOpen(project.shareSlug);
                    }
                  }}
                  disabled={!project.shareSlug}
                  className="min-w-0 text-left disabled:opacity-50"
                >
                  <p className="text-sm text-white truncate">{project.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                    <span>{new Date(project.createdAt).toLocaleDateString()}</span>
                    <span>{project.nodeCount} nodes</span>
                    {project.monthlyCost !== null && (
                      <span className="text-green-400">${project.monthlyCost.toFixed(0)}/mo</span>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(project.id)}
                  className="p-1 rounded text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-gray-700 transition-all"
                  aria-label="Delete project"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
