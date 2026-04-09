import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { iconForNode } from "../Scene3Generation/awsIcons";

const FF = '"DM Sans", system-ui, sans-serif';

const CATEGORY_COLORS: Record<string, string> = {
  compute: "#f97316",
  database: "#22c55e",
  storage: "#eab308",
  security: "#ef4444",
  monitoring: "#a855f7",
  network: "#3b82f6",
};

interface Props {
  x: number;
  y: number;
  serviceType: string;
  category: string;
  appearAt: number;
  jitterPhase: number;
  errorLabel?: string;
}

export const AwsIcon: React.FC<Props> = ({ x, y, serviceType, category, appearAt, jitterPhase, errorLabel }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const p = spring({ frame: frame - appearAt, fps, config: { damping: 8 }, durationInFrames: 30 });

  const scale = interpolate(p, [0, 1], [0, 1]);
  const translateY = interpolate(p, [0, 1], [-20, 0]);
  const opacity = interpolate(p, [0, 0.15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const jitter = Math.sin(frame * 0.38 + jitterPhase) * 3.5;

  const color = CATEGORY_COLORS[category] ?? "#94a3b8";

  const errorOpacity = interpolate(
    frame,
    [appearAt + 12, appearAt + 22],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity,
        transform: `scale(${scale}) translateY(${translateY}px) rotate(${jitter}deg)`,
        transformOrigin: "center bottom",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
      }}
    >
      <div
        style={{
          width: 100,
          height: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          border: `2px solid ${color}`,
          borderRadius: 14,
          boxShadow: `0 2px 14px rgba(0,0,0,0.10), 0 0 0 5px ${color}22`,
        }}
      >
        <div style={{ transform: "scale(1.8)", display: "flex" }}>
          {iconForNode(serviceType, color)}
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color, fontFamily: FF, letterSpacing: "0.04em" }}>
        {serviceType.toUpperCase()}
      </div>

      {errorLabel && (
        <div
          style={{
            opacity: errorOpacity,
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            color: "#dc2626",
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: 20,
            fontFamily: FF,
            whiteSpace: "nowrap",
          }}
        >
          ● {errorLabel}
        </div>
      )}
    </div>
  );
};
