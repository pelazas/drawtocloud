import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  x: number;
  y: number;
  appearAt: number;
  jitterPhase: number;
}

export const WarningIcon: React.FC<Props> = ({ x, y, appearAt, jitterPhase }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const p = spring({ frame: frame - appearAt, fps, config: { damping: 8 }, durationInFrames: 30 });

  const scale = interpolate(p, [0, 1], [0, 1]);
  const translateY = interpolate(p, [0, 1], [-20, 0]);
  const opacity = interpolate(p, [0, 0.15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const jitter = Math.sin(frame * 0.42 + jitterPhase) * 4.5;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 80,
        height: 80,
        opacity,
        transform: `scale(${scale}) translateY(${translateY}px) rotate(${jitter}deg)`,
        transformOrigin: "center bottom",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fff1f2",
        border: "2px solid #fca5a5",
        borderRadius: 12,
        boxShadow: "0 2px 14px rgba(239,68,68,0.14), 0 0 0 4px rgba(239,68,68,0.06)",
      }}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path d="M20 5 L37 34 H3 Z" stroke="#ef4444" strokeWidth="2.5" strokeLinejoin="round" fill="#ef444418" />
        <line x1="20" y1="17" x2="20" y2="26" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="20" cy="30" r="1.5" fill="#ef4444" />
      </svg>
    </div>
  );
};
