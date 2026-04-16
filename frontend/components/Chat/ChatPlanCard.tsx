"use client";

import type { CanvasMessage } from "@/lib/projects";

interface ChatPlanCardProps {
  msg: CanvasMessage;
  onAcceptAndGenerate?: (planId?: string) => void;
  approveDisabled?: boolean;
}

export default function ChatPlanCard({
  msg,
  onAcceptAndGenerate,
  approveDisabled,
}: ChatPlanCardProps) {
  const details = msg.planMeta?.details;
  if (!details) return null;

  return (
    <div className="ml-1 mt-2 mb-2 p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs">
      <div className="font-semibold text-gray-200 mb-2">Planned Changes</div>

      {details.nodes_added && details.nodes_added.length > 0 && (
        <div className="mb-1">
          <span className="text-green-400">Add:</span>{" "}
          {details.nodes_added.map((n) => n.label).join(", ")}
        </div>
      )}
      {details.nodes_edited && details.nodes_edited.length > 0 && (
        <div className="mb-1">
          <span className="text-blue-400">Edit:</span>{" "}
          {details.nodes_edited.map((n) => n.label).join(", ")}
        </div>
      )}
      {details.nodes_deleted && details.nodes_deleted.length > 0 && (
        <div className="mb-1">
          <span className="text-red-400">Delete:</span>{" "}
          {details.nodes_deleted.map((n) => n.label).join(", ")}
        </div>
      )}
      {details.edges_added && details.edges_added.length > 0 && (
        <div className="mb-1">
          <span className="text-green-400">Add connections:</span>{" "}
          {details.edges_added.map((e) => e.label || `${e.from} → ${e.to}`).join(", ")}
        </div>
      )}
      {details.edges_deleted && details.edges_deleted.length > 0 && (
        <div className="mb-1">
          <span className="text-red-400">Remove connections:</span>{" "}
          {details.edges_deleted.map((e) => e.label || `${e.from} → ${e.to}`).join(", ")}
        </div>
      )}
      {details.reasoning && (
        <div className="mt-2 text-gray-400 italic">{details.reasoning}</div>
      )}

      {onAcceptAndGenerate && (
        <div className="flex justify-start pl-1 mt-3">
          <button
            type="button"
            onClick={() => onAcceptAndGenerate(msg.planMeta?.plan_id)}
            disabled={approveDisabled}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {approveDisabled ? "Applying update..." : "Implement plan"}
          </button>
        </div>
      )}
    </div>
  );
}
