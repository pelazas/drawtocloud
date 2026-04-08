import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const CATEGORY_COLORS: Record<string, string> = {
  compute: "#f97316",
  database: "#22c55e",
  storage: "#eab308",
  monitoring: "#a855f7",
  network: "#3b82f6",
  security: "#ef4444",
};

const FF = '"DM Sans", system-ui, sans-serif';

interface Props {
  label: string;
  sublabel?: string;
  category: string;
  x: number;
  y: number;
  appearAt: number;
}

export const DiagramNode: React.FC<Props> = ({ label, sublabel, category, x, y, appearAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - appearAt;
  const color = CATEGORY_COLORS[category] ?? "#6b7280";

  const scale = local >= 0
    ? spring({ frame: local, fps, config: { damping: 12, stiffness: 200, mass: 0.8 }, durationInFrames: 20 })
    : 0;

  const glow = interpolate(local, [0, 28], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ty = interpolate(scale, [0, 1], [-8, 0]);
  const glowAlpha = Math.round(glow * 55).toString(16).padStart(2, "0");

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 140,
        height: 124,
        borderRadius: 10,
        backgroundColor: "#0d1117",
        border: "1px solid #1f2937",
        borderLeft: `3px solid ${color}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transform: `translateY(${ty}px) scale(${scale})`,
        transformOrigin: "center center",
        opacity: scale,
        boxShadow: `0 0 22px ${color}${glowAlpha}, 0 4px 16px rgba(0,0,0,0.6)`,
        fontFamily: FF,
      }}
    >
      {/* Cloud / service icon */}
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
      </svg>

      <div style={{ textAlign: "center", padding: "0 8px" }}>
        <div style={{ color: "#e5e7eb", fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{label}</div>
        {sublabel && (
          <div style={{ color: "#6b7280", fontSize: 10, marginTop: 2, lineHeight: 1.2 }}>{sublabel}</div>
        )}
      </div>

      {/* Top/bottom connection dots */}
      <div style={{ position: "absolute", top: -4, left: "50%", transform: "translateX(-50%)", width: 7, height: 7, borderRadius: "50%", backgroundColor: "#374151", border: "1.5px solid #6b7280" }} />
      <div style={{ position: "absolute", bottom: -4, left: "50%", transform: "translateX(-50%)", width: 7, height: 7, borderRadius: "50%", backgroundColor: "#374151", border: "1.5px solid #6b7280" }} />
    </div>
  );
};
