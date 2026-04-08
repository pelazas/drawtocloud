import React from "react";

interface Props {
  opacity: number;
}

export const CanvasContainer: React.FC<Props> = ({ opacity }) => (
  <div
    style={{
      position: "absolute",
      left: 330,
      top: 150,
      width: 1200,
      height: 700,
      border: "2px dashed #3b82f699",
      borderRadius: 12,
      backgroundColor: "rgba(59,130,246,0.04)",
      opacity,
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 12,
        top: 8,
        color: "#60a5fa",
        fontSize: 12,
        letterSpacing: "0.08em",
        fontFamily: '"SF Mono","Fira Code","Cascadia Code",monospace',
      }}
    >
      VPC
    </div>
  </div>
);
