import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { iconForNode } from "./awsIcons";

const CATEGORY_COLORS: Record<string, string> = {
  compute: "#f97316",
  database: "#22c55e",
  storage: "#eab308",
  monitoring: "#a855f7",
  network: "#3b82f6",
  security: "#ef4444",
};

const FF = '"DM Sans", system-ui, sans-serif';

export const NODE_W = 210;
export const NODE_H = 190;

interface Props {
  label: string;
  sublabel?: string;
  category: string;
  serviceType: string;
  x: number;
  y: number;
  appearAt: number;
}

export const DiagramNode: React.FC<Props> = ({ label, sublabel, category, serviceType, x, y, appearAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - appearAt;
  const color = CATEGORY_COLORS[category] ?? "#6b7280";

  const scale = local >= 0
    ? spring({ frame: local, fps, config: { damping: 12, stiffness: 200, mass: 0.8 }, durationInFrames: 20 })
    : 0;

  const glow = interpolate(local, [0, 30], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ty = interpolate(scale, [0, 1], [-10, 0]);
  const glowAlpha = Math.round(glow * 55).toString(16).padStart(2, "0");

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: NODE_W,
        height: NODE_H,
        borderRadius: 14,
        backgroundColor: "#0d1117",
        border: "1px solid #1f2937",
        borderLeft: `4px solid ${color}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        transform: `translateY(${ty}px) scale(${scale})`,
        transformOrigin: "center center",
        opacity: scale,
        boxShadow: `0 0 28px ${color}${glowAlpha}, 0 6px 20px rgba(0,0,0,0.7)`,
        fontFamily: FF,
      }}
    >
      {/* Scale the 32×32 icon up to ~48×48 */}
      <div style={{ transform: "scale(1.5)", transformOrigin: "center center", lineHeight: 0 }}>
        {iconForNode(serviceType, color)}
      </div>

      <div style={{ textAlign: "center", padding: "0 10px" }}>
        <div style={{ color: "#e5e7eb", fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>{label}</div>
        {sublabel && (
          <div style={{ color: "#6b7280", fontSize: 14, marginTop: 4, lineHeight: 1.2 }}>{sublabel}</div>
        )}
      </div>

      {/* Connection handle dots */}
      <div style={{ position: "absolute", top: -5, left: "50%", transform: "translateX(-50%)", width: 8, height: 8, borderRadius: "50%", backgroundColor: "#1f2937", border: "1.5px solid #6b7280" }} />
      <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", width: 8, height: 8, borderRadius: "50%", backgroundColor: "#1f2937", border: "1.5px solid #6b7280" }} />
    </div>
  );
};
