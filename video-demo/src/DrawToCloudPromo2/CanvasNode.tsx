import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { CATEGORY_COLORS, FF } from "./constants";

interface Props {
  label: string;
  category: keyof typeof CATEGORY_COLORS;
  x: number;
  y: number;
  appearAt: number;
}

export const CanvasNode: React.FC<Props> = ({ label, category, x, y, appearAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - appearAt;
  const color = CATEGORY_COLORS[category];

  const progress = spring({
    frame: local,
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.8 },
    durationInFrames: 18,
  });

  const glow = interpolate(local, [0, 20], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 140,
        height: 124,
        borderRadius: 12,
        backgroundColor: "#111827",
        border: "1px solid #374151",
        borderLeft: `3px solid ${color}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        transform: `translateY(${interpolate(progress, [0, 1], [-10, 0])}px) scale(${progress})`,
        transformOrigin: "center",
        opacity: progress,
        boxShadow: `0 0 22px ${color} ${Math.max(0, glow * 0.5)}`,
        fontFamily: FF,
      }}
    >
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8}>
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="M8 10h8M8 14h4" />
      </svg>
      <div style={{ color: "#e5e7eb", fontSize: 14, textAlign: "center", lineHeight: 1.25, padding: "0 8px", fontWeight: 600 }}>{label}</div>
    </div>
  );
};
