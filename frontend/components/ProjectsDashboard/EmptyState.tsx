"use client";

import { FolderKanban, Plus } from "lucide-react";

type Props = {
  onNewGeneration: () => void;
};

export default function EmptyState({ onNewGeneration }: Props) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 px-8 py-16 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 text-blue-300">
        <FolderKanban size={26} />
      </div>
      <h3 className="text-xl font-semibold">No projects yet. Create your first architecture!</h3>
      <p className="mt-2 text-sm text-gray-400">
        Start with the questionnaire and generate your first cloud diagram.
      </p>
      <button
        type="button"
        onClick={onNewGeneration}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
      >
        <Plus size={16} />
        New Generation
      </button>
    </div>
  );
}
