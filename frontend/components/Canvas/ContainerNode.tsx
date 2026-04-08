"use client";
import React from "react";
import { getContainerNodeStyles, type ContainerType } from "@/components/Canvas/containerNodeStyles";

type ContainerNodeData = { label: string; category: string; containerType?: ContainerType; isDragOver?: boolean };

export default function ContainerNode({ data, selected }: { data: ContainerNodeData; selected: boolean }) {
  const styles = getContainerNodeStyles(data.containerType, selected, data.isDragOver === true);
  return (
    <div
      data-testid="container-node"
      data-container-type={data.containerType ?? "vpc"}
      className="border-2 border-dashed rounded-xl w-full h-full relative transition-shadow duration-150"
      style={styles}
    >
      <div
        className="absolute top-2 left-3 text-xs font-mono uppercase tracking-widest"
        style={{ color: styles.labelColor }}
      >
        {data.label}
      </div>
    </div>
  );
}
