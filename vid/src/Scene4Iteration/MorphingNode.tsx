import React from "react";
import {
  interpolate,
  useCurrentFrame,
} from "remotion";
import { iconForNode } from "../Scene3Generation/awsIcons";
import { NODE_W, NODE_H } from "../Scene3Generation/DiagramNode";

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
  beforeLabel: string;
  beforeSublabel?: string;
  beforeCategory: string;
  beforeServiceType: string;
  afterLabel: string;
  afterSublabel?: string;
  afterCategory: string;
  afterServiceType: string;
  x: number;
  y: number;
  morphAt: number;
  alreadyVisible?: boolean;
}

export const MorphingNode: React.FC<Props> = ({
  beforeLabel,
  beforeSublabel,
  beforeCategory,
  beforeServiceType,
  afterLabel,
  afterSublabel,
  afterCategory,
  afterServiceType,
  x,
  y,
  morphAt,
  alreadyVisible = false,
}) => {
  const frame = useCurrentFrame();
  const local = frame - morphAt;

  const beforeColor = CATEGORY_COLORS[beforeCategory] ?? "#6b7280";
  const afterColor = CATEGORY_COLORS[afterCategory] ?? "#6b7280";

  // No entrance spring — already visible from frame 0
  const scale = alreadyVisible ? 1 : 0;
  const opacity = alreadyVisible ? 1 : 0;

  // Morph transition over 20 frames
  const morphProgress = interpolate(local, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Scale bounce: 1.0 → 1.08 → 1.0 during morph
  const bounceScale = interpolate(local, [0, 6, 20], [1.0, 1.08, 1.0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Glow flash during morph: bright in the middle, fades at both ends
  const glowIntensity = interpolate(local, [0, 6, 20], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Crossfade: before fades out, after fades in
  const beforeOpacity = 1 - morphProgress;
  const afterOpacity = morphProgress;

  // Border color: pick dominant based on progress
  const borderColor = morphProgress < 0.5 ? beforeColor : afterColor;

  // Glow flash alpha (up to AA hex = 170 decimal)
  const glowAlpha = Math.round(glowIntensity * 170)
    .toString(16)
    .padStart(2, "0");

  const finalScale = scale * bounceScale;

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
        borderLeft: `4px solid ${borderColor}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        transform: `scale(${finalScale})`,
        transformOrigin: "center center",
        opacity,
        boxShadow:
          glowIntensity > 0
            ? `0 0 48px ${afterColor}${glowAlpha}, 0 8px 32px rgba(0,0,0,0.8)`
            : `0 6px 20px rgba(0,0,0,0.7)`,
        fontFamily: FF,
      }}
    >
      {/* Before content (fading out) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          opacity: beforeOpacity,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            transform: "scale(1.5)",
            transformOrigin: "center center",
            lineHeight: 0,
          }}
        >
          {iconForNode(beforeServiceType, beforeColor)}
        </div>
        <div style={{ textAlign: "center", padding: "0 10px" }}>
          <div
            style={{
              color: "#e5e7eb",
              fontSize: 18,
              fontWeight: 600,
              lineHeight: 1.3,
            }}
          >
            {beforeLabel}
          </div>
          {beforeSublabel && (
            <div
              style={{
                color: "#6b7280",
                fontSize: 14,
                marginTop: 4,
                lineHeight: 1.2,
              }}
            >
              {beforeSublabel}
            </div>
          )}
        </div>
      </div>

      {/* After content (fading in) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          opacity: afterOpacity,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            transform: "scale(1.5)",
            transformOrigin: "center center",
            lineHeight: 0,
          }}
        >
          {iconForNode(afterServiceType, afterColor)}
        </div>
        <div style={{ textAlign: "center", padding: "0 10px" }}>
          <div
            style={{
              color: "#e5e7eb",
              fontSize: 18,
              fontWeight: 600,
              lineHeight: 1.3,
            }}
          >
            {afterLabel}
          </div>
          {afterSublabel && (
            <div
              style={{
                color: "#6b7280",
                fontSize: 14,
                marginTop: 4,
                lineHeight: 1.2,
              }}
            >
              {afterSublabel}
            </div>
          )}
        </div>
      </div>

      {/* Connection handle dots */}
      <div
        style={{
          position: "absolute",
          top: -5,
          left: "50%",
          transform: "translateX(-50%)",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "#1f2937",
          border: "1.5px solid #6b7280",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -5,
          left: "50%",
          transform: "translateX(-50%)",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "#1f2937",
          border: "1.5px solid #6b7280",
        }}
      />
    </div>
  );
};
