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
          className="inline-flex items-center gap-1.5 bg-gray-800/80 border border-gray-600/50 rounded-md px-2 py-0.5 text-xs text-gray-200"
        >
          <button
            type="button"
            onClick={() => onDeselect(node.id)}
            className="text-gray-400 hover:text-white transition-colors focus:outline-none focus:text-white"
            aria-label={`Remove ${node.label} from selection`}
          >
            ×
          </button>
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: colorForCategory(node.category) }}
            aria-hidden
          />
          <span className="truncate max-w-[100px]">{node.label}</span>
        </div>
      ))}
    </div>
  );
}
