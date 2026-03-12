"use client";
import React from "react";
import { colorForCategory } from "@/lib/categoryColors";

type ContainerNodeData = { label: string; category: string };

export default function ContainerNode({ data, selected }: { data: ContainerNodeData; selected: boolean }) {
  const borderColor = colorForCategory("network"); // #3b82f6
  return (
    <div
      data-testid="container-node"
      style={{ borderColor: borderColor + "99", background: "rgba(59,130,246,0.04)" }}
      className={`border-2 border-dashed rounded-xl w-full h-full relative ${selected ? 'border-blue-500' : ''}`}
    >
      <div className="absolute top-2 left-3 text-xs font-mono text-blue-400 uppercase tracking-widest">
        {data.label}
      </div>
    </div>
  );
}
