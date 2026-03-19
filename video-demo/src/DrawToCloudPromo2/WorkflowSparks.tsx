import React from "react";
import { interpolate, spring } from "remotion";

const SPARKS = [
  { angle: 0,   dist: 100, color: "#60a5fa", r: 5 },
  { angle: 28,  dist: 75,  color: "#818cf8", r: 4 },
  { angle: 60,  dist: 110, color: "#ffffff", r: 3 },
  { angle: 88,  dist: 85,  color: "#3b82f6", r: 5 },
  { angle: 120, dist: 95,  color: "#818cf8", r: 4 },
  { angle: 148, dist: 80,  color: "#60a5fa", r: 3 },
  { angle: 180, dist: 105, color: "#3b82f6", r: 5 },
  { angle: 208, dist: 72,  color: "#ffffff", r: 3 },
  { angle: 240, dist: 90,  color: "#818cf8", r: 4 },
  { angle: 268, dist: 115, color: "#60a5fa", r: 5 },
  { angle: 300, dist: 82,  color: "#3b82f6", r: 4 },
  { angle: 328, dist: 98,  color: "#818cf8", r: 3 },
];

// Smaller inner sparks for density
const INNER_SPARKS = [
  { angle: 14,  dist: 45, color: "#f0abfc" },
  { angle: 74,  dist: 52, color: "#fbbf24" },
  { angle: 134, dist: 40, color: "#34d399" },
  { angle: 194, dist: 55, color: "#f0abfc" },
  { angle: 254, dist: 42, color: "#fbbf24" },
  { angle: 314, dist: 50, color: "#34d399" },
];

interface WorkflowSparksProps {
  localFrame: number;
  fps: number;
  cx: number;
  cy: number;
}

export const WorkflowSparks: React.FC<WorkflowSparksProps> = ({ localFrame, fps, cx, cy }) => (
  <svg style={{ position: "absolute", inset: 0, pointerEvents: "none", width: "100%", height: "100%", overflow: "visible" }}>
    {SPARKS.map((s, i) => {
      const delay = i * 1.5;
      const p = spring({ frame: localFrame - delay, fps, config: { damping: 22, stiffness: 300 }, durationInFrames: 20 });
      const dist = interpolate(p, [0, 1], [0, s.dist], { extrapolateRight: "clamp" });
      const opacity = interpolate(p, [0.15, 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const size = interpolate(p, [0, 0.25, 1], [0, s.r, s.r * 0.6]);
      const rad = (s.angle * Math.PI) / 180;
      return (
        <circle key={i} cx={cx + Math.cos(rad) * dist} cy={cy + Math.sin(rad) * dist}
          r={size} fill={s.color} opacity={opacity} />
      );
    })}
    {INNER_SPARKS.map((s, i) => {
      const delay = i * 2;
      const p = spring({ frame: localFrame - delay, fps, config: { damping: 30, stiffness: 400 }, durationInFrames: 14 });
      const dist = interpolate(p, [0, 1], [0, s.dist], { extrapolateRight: "clamp" });
      const opacity = interpolate(p, [0.1, 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const rad = (s.angle * Math.PI) / 180;
      return (
        <circle key={`i${i}`} cx={cx + Math.cos(rad) * dist} cy={cy + Math.sin(rad) * dist}
          r={interpolate(p, [0, 0.3, 1], [0, 3, 2])} fill={s.color} opacity={opacity} />
      );
    })}
    {/* Button glow ring */}
    <circle cx={cx} cy={cy} r={interpolate(
      spring({ frame: localFrame, fps, config: { damping: 15, stiffness: 200 }, durationInFrames: 22 }),
      [0, 1], [0, 140]
    )} fill="none" stroke="#3b82f6" strokeWidth={2}
      opacity={interpolate(spring({ frame: localFrame, fps, config: { damping: 15, stiffness: 200 }, durationInFrames: 22 }), [0, 0.3, 1], [0.8, 0.4, 0])} />
  </svg>
);
