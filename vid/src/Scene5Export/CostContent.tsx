import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const FF = '"DM Sans", system-ui, sans-serif';
const MONO = '"SF Mono","Fira Code","Cascadia Code",monospace';

const BREAKDOWN = [
  { label: "EC2 × 2 (t3.medium)", cost: "$46.72" },
  { label: "RDS PostgreSQL (db.t3.medium)", cost: "$38.40" },
  { label: "ALB", cost: "$18.25" },
  { label: "S3 (50 GB storage)", cost: "$12.63" },
  { label: "CloudWatch (log retention)", cost: "$11.00" },
];

const STAGGER = 6;
const TOTAL = "$127.00";

interface Props {
  fadeInFrom: number;
  countUpFrom: number;
  countUpEnd: number;
}

export const CostContent: React.FC<Props> = ({ fadeInFrom, countUpFrom, countUpEnd }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const panelOpacity = interpolate(frame, [fadeInFrom, fadeInFrom + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const costValue = Math.floor(
    interpolate(frame, [countUpFrom, countUpEnd], [0, 127], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  const pulse = interpolate(frame, [countUpFrom, countUpFrom + 12], [0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  });

  if (panelOpacity <= 0) return null;

  return (
    <div
      style={{
        padding: "24px 8px",
        opacity: panelOpacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontFamily: FF,
          fontSize: 16,
          fontWeight: 500,
          color: "#6b7280",
          marginBottom: 8,
          letterSpacing: "0.04em",
        }}
      >
        Estimated monthly cost
      </div>

      <div
        style={{
          fontFamily: MONO,
          fontSize: 72,
          fontWeight: 900,
          color: "#ffffff",
          transform: `scale(${pulse})`,
          marginBottom: 32,
          letterSpacing: "-0.02em",
        }}
      >
        ~${costValue}<span style={{ fontSize: 36, fontWeight: 600, color: "#94a3b8" }}>/mo</span>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 520,
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        {BREAKDOWN.map((row, i) => {
          const rowStart = countUpEnd + i * STAGGER;
          const rowOpacity = spring({
            frame: frame - rowStart,
            fps,
            config: { damping: 200 },
          });

          if (rowOpacity <= 0) return null;

          return (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                opacity: rowOpacity,
              }}
            >
              <span
                style={{
                  fontFamily: FF,
                  fontSize: 15,
                  color: "#d1d5db",
                  fontWeight: 400,
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 15,
                  color: "#94a3b8",
                  fontWeight: 500,
                }}
              >
                {row.cost}
              </span>
            </div>
          );
        })}

        {(() => {
          const totalStart = countUpEnd + BREAKDOWN.length * STAGGER;
          const totalOpacity = spring({
            frame: frame - totalStart,
            fps,
            config: { damping: 200 },
          });

          if (totalOpacity <= 0) return null;

          return (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 0 4px",
                borderTop: "2px solid rgba(255,255,255,0.12)",
                opacity: totalOpacity,
              }}
            >
              <span
                style={{
                  fontFamily: FF,
                  fontSize: 16,
                  color: "#ffffff",
                  fontWeight: 700,
                }}
              >
                Total
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 18,
                  color: "#22c55e",
                  fontWeight: 700,
                }}
              >
                {TOTAL}
              </span>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
