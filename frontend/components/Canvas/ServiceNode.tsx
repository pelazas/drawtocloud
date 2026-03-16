"use client";
import React from "react";
import { Handle, Position } from "reactflow";
import { iconForNode, deriveNodeType } from "@/lib/awsIcons";
import { colorForCategory } from "@/lib/categoryColors";

type ServiceNodeData = {
  label: string;
  category: string;
  nodeType?: string;
};

export default function ServiceNode({ data, selected }: { data: ServiceNodeData; selected: boolean }) {
  const color = colorForCategory(data.category);
  const nodeType = data.nodeType ?? deriveNodeType(
    data.label?.toLowerCase().replace(/\s+/g, "_") ?? ""
  );

  return (
    <div
      data-testid="service-node"
      className={`bg-gray-900 rounded-lg p-3 border w-[100px] flex flex-col items-center gap-2 transition-shadow duration-150 ${
        selected ? "border-blue-500" : "border-gray-700"
      }`}
      style={{
        borderLeftColor: color,
        borderLeftWidth: "2px",
        ...(selected
          ? { boxShadow: "0 0 0 1px rgba(59,130,246,0.3), inset 0 0 20px rgba(59,130,246,0.05)" }
          : {}),
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-500" />
      <div className="flex items-center justify-center">
        {iconForNode(nodeType, color)}
      </div>
      <span className="text-xs text-gray-200 text-center leading-tight break-words w-full">
        {data.label}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-500" />
    </div>
  );
}
