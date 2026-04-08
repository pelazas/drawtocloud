"use client";
import React from "react";
import { getContainerNodeStyles, type ContainerType, type SubnetKind } from "@/components/Canvas/containerNodeStyles";

type ContainerNodeData = {
  label: string;
  category: string;
  containerType?: ContainerType;
  subnetKind?: SubnetKind;
  isDragOver?: boolean;
};

export default function ContainerNode({ data, selected }: { data: ContainerNodeData; selected: boolean }) {
  const styles = getContainerNodeStyles(data.containerType, selected, data.isDragOver === true, data.subnetKind);
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
      {styles.badgeLabel ? (
        <div
          className="absolute top-2 right-3 rounded-full border px-2 py-0.5 text-[10px] font-mono font-semibold tracking-[0.18em]"
          style={{ color: styles.badgeColor, borderColor: `${styles.badgeColor}55`, background: `${styles.badgeColor}12` }}
        >
          {styles.badgeLabel}
        </div>
      ) : null}
    </div>
  );
}
