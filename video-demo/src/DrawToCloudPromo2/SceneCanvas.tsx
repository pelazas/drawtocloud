import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { CanvasContainer } from "./CanvasContainer";
import { CanvasNode } from "./CanvasNode";
import { SceneOutputPanel } from "./SceneOutputPanel";

const nodes = [
  ["igw", "Internet Gateway", "network", 910, 185],
  ["alb", "Application Load Balancer", "compute", 860, 275],
  ["ecs", "ECS Fargate", "compute", 640, 430],
  ["rds", "RDS PostgreSQL", "database", 1030, 430],
  ["cache", "ElastiCache", "database", 1020, 580],
  ["s3", "S3 Bucket", "storage", 1530, 430],
  ["cw", "CloudWatch", "monitoring", 1490, 610],
  ["iam", "IAM Role", "security", 860, 760],
] as const;

const edges = [
  [960, 277, 910, 322],
  [960, 367, 690, 476],
  [740, 476, 1030, 476],
  [740, 476, 1020, 626],
  [740, 476, 1530, 476],
  [1490, 656, 740, 476],
  [910, 806, 700, 520],
] as const;

export const SceneCanvas: React.FC = () => {
  const frame = useCurrentFrame();

  const split = interpolate(frame, [150, 180], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const canvasWidth = interpolate(split, [0, 1], [100, 60]);

  const breathe = interpolate(frame, [108, 138, 180], [1, 1.04, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${canvasWidth}%`, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${breathe})`, transformOrigin: "50% 50%" }}>
          <svg style={{ position: "absolute", inset: 0, opacity: 0.5 }}>
            <defs>
              <pattern id="dots-v2" width="28" height="28" patternUnits="userSpaceOnUse">
                <circle cx="14" cy="14" r="1.5" fill="rgba(255,255,255,0.04)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dots-v2)" />
          </svg>

          <CanvasContainer
            opacity={interpolate(frame, [0, 12], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          />

          <svg style={{ position: "absolute", inset: 0 }}>
            {edges.map(([x1, y1, x2, y2], i) => {
              const sourceAppear = 12 + i * 12;
              const edgeStart = sourceAppear + 8;
              const length = Math.hypot(x2 - x1, y2 - y1);
              const draw = interpolate(frame, [edgeStart, edgeStart + 8], [length, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });

              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray={length}
                  strokeDashoffset={draw}
                  opacity={frame >= edgeStart ? 1 : 0}
                />
              );
            })}
          </svg>

          {nodes.map(([id, label, category, x, y], i) => (
            <CanvasNode
              key={id}
              label={label}
              category={category}
              x={x}
              y={y}
              appearAt={12 + i * 12}
            />
          ))}
        </div>
      </div>

      {frame >= 150 && <SceneOutputPanel startFrame={150} />}

      {frame >= 150 && (
        <div
          style={{
            position: "absolute",
            left: `calc(${canvasWidth}% - 1px)`,
            top: 0,
            bottom: 0,
            width: 1,
            backgroundColor: "#21262d",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
