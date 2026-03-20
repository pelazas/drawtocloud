import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { CanvasContainer } from "./CanvasContainer";
import { CanvasNode } from "./CanvasNode";
import { SceneOutputPanel } from "./SceneOutputPanel";

const nodes = [
  ["igw", "Internet Gateway", "network", 930, 120],
  ["alb", "Application Load Balancer", "compute", 860, 300],
  ["ecs", "ECS Fargate", "compute", 640, 430],
  ["rds", "RDS PostgreSQL", "database", 1030, 430],
  ["cache", "ElastiCache", "database", 1020, 580],
  ["s3", "S3 Bucket", "storage", 1530, 430],
  ["cw", "CloudWatch", "monitoring", 1490, 610],
  ["iam", "IAM Role", "security", 860, 760],
] as const;

const edges = [
  [1000, 244, 930, 300],
  [930, 424, 710, 430],
  [780, 492, 1030, 492],
  [760, 540, 1020, 642],
  [780, 492, 1530, 492],
  [1490, 672, 780, 520],
  [930, 760, 730, 554],
] as const;

export const SceneCanvas: React.FC = () => {
  const frame = useCurrentFrame();
  const PANEL_START = 195;
  const EDGE_BUILD_START = 108; // Global 1043 (SceneCanvas starts at global 935)
  const EDGE_BUILD_END = EDGE_BUILD_START + 80;
  const COST_MOVE_START = 243; // Global 1178 (SceneCanvas starts at global 935)
  const COST_MOVE_END = COST_MOVE_START + 20;
  const COST_CLICK_FRAME = COST_MOVE_END + 10;
  const costClickEnd = COST_CLICK_FRAME + 4;
  const costCursorX = interpolate(frame, [COST_MOVE_START, COST_MOVE_END], [1540, 1470], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const costCursorY = interpolate(frame, [COST_MOVE_START, COST_MOVE_END], [300, 30], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const costCursorScale = frame >= COST_CLICK_FRAME && frame <= costClickEnd
    ? interpolate(frame, [COST_CLICK_FRAME, COST_CLICK_FRAME + 2, costClickEnd], [1, 0.75, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;
  const showCostCursor = frame >= COST_MOVE_START && frame <= costClickEnd + 2;

  const split = interpolate(frame, [PANEL_START, PANEL_START + 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const canvasWidth = interpolate(split, [0, 1], [100, 70]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${canvasWidth}%`, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <svg style={{ position: "absolute", inset: 0, opacity: 0.5 }}>
            <defs>
              <pattern id="dots-v2" width="28" height="28" patternUnits="userSpaceOnUse">
                <circle cx="14" cy="14" r="1.5" fill="rgba(255,255,255,0.04)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dots-v2)" />
          </svg>

          <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
            <CanvasContainer
              opacity={interpolate(frame, [0, 12], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })}
            />
          </div>

          <svg style={{ position: "absolute", inset: 0, zIndex: 2, overflow: "visible" }}>
            {edges.map(([x1, y1, x2, y2], i) => {
              const edgeStart = i === 0 ? EDGE_BUILD_START : EDGE_BUILD_START + i * 6;
              const edgeEnd = i === 0
                ? EDGE_BUILD_START + 10 // Global 1043 -> 1053 for IGW -> ALB
                : Math.min(EDGE_BUILD_END, edgeStart + 36);
              const edgeProgress = interpolate(frame, [edgeStart, edgeEnd], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const currentX2 = interpolate(edgeProgress, [0, 1], [x1, x2], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const currentY2 = interpolate(edgeProgress, [0, 1], [y1, y2], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const edgeOpacity = interpolate(frame, [EDGE_BUILD_START, EDGE_BUILD_START + 10], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });

              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={currentX2}
                  y2={currentY2}
                  stroke="#9ca3af"
                  strokeWidth={2}
                  strokeDasharray="8 9"
                  strokeLinecap="round"
                  opacity={edgeOpacity}
                />
              );
            })}
          </svg>

          <div style={{ position: "absolute", inset: 0, zIndex: 3 }}>
            {nodes.map(([id, label, category, x, y], i) => {
              const appearAt = 12 + i * 12;
              return (
                <React.Fragment key={id}>
                  <CanvasNode
                    label={label}
                    category={category}
                    x={x}
                    y={y}
                    appearAt={appearAt}
                  />
                  <Sequence from={appearAt}>
                    <Audio
                      src={staticFile("friendly-pop.wav")}
                      volume={() => 0.16 + (i % 3) * 0.03}
                    />
                  </Sequence>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {frame >= PANEL_START && <SceneOutputPanel startFrame={PANEL_START} switchToCostAt={COST_CLICK_FRAME - PANEL_START} />}

      {frame >= PANEL_START && (
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

      {showCostCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: costCursorX,
            top: costCursorY,
            transform: `translate(-4px, -2px) scale(${costCursorScale})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
            zIndex: 60,
          }}
        >
          <path d="M4 2 L4 18 L8 14 L12 22 L14 21 L10 13 L16 13 Z" fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}
    </AbsoluteFill>
  );
};
