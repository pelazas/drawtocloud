"use client";

import { colorForCategory } from "@/lib/categoryColors";

export type ChatSelectionNode = {
  id: string;
  label: string;
  category: string;
};

type ChatSelectionChipsProps = {
  selectedNodes: ChatSelectionNode[];
  onDeselect: (id: string) => void;
};

export default function ChatSelectionChips({ selectedNodes, onDeselect }: ChatSelectionChipsProps) {
  if (selectedNodes.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-gray-700">
      {selectedNodes.map((node) => (
        <div
          key={node.id}
          className="inline-flex items-center gap-1.5 bg-white/10 border border-white/10 rounded-md px-2 py-0.5 text-xs text-gray-200"
        >
          <button
            type="button"
            onClick={() => onDeselect(node.id)}
            className="text-gray-300 hover:text-white transition-colors"
            aria-label={`Remove ${node.label} from selection`}
          >
            ×
          </button>
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: colorForCategory(node.category) }}
            aria-hidden
          />
          <span>{node.label}</span>
        </div>
      ))}
    </div>
  );
}
