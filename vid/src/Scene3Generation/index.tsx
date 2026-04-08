import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { DiagramEdge } from "./DiagramEdge";
import { DiagramNode } from "./DiagramNode";
import { VpcFrame } from "./VpcFrame";

// Canvas: 1920x1080. Nodes are 140x124.
// Node (x,y) = top-left corner. Center = (x+70, y+62).
const NODES = [
  { id: "alb",  label: "Load Balancer",   sublabel: "ALB",        category: "compute",    x: 720,  y: 155 },
  { id: "ec2a", label: "EC2 Instance",    sublabel: "App Server", category: "compute",    x: 500,  y: 355 },
  { id: "ec2b", label: "EC2 Instance",    sublabel: "App Server", category: "compute",    x: 940,  y: 355 },
  { id: "rds",  label: "RDS PostgreSQL",  sublabel: "db.t3.med",  category: "database",   x: 720,  y: 560 },
  { id: "s3",   label: "S3 Bucket",       sublabel: "Assets",     category: "storage",    x: 1330, y: 235 },
  { id: "cw",   label: "CloudWatch",      sublabel: "Monitoring", category: "monitoring", x: 1330, y: 455 },
] as const;

// appearAt in frames (30fps)
const NODE_APPEAR = [8, 24, 38, 52, 66, 80] as const;

// Edges: source/target are center connection points on node borders
// ALB center: (790,217)  bottom: (790,279)
// EC2a center: (570,417) top: (570,355)  bottom: (570,479)  right: (640,417)
// EC2b center: (1010,417) top: (1010,355) bottom: (1010,479) right: (1080,417)
// RDS top: (790,560)
// S3 left: (1330,297)
// CW left: (1330,517)
const EDGES = [
  { x1: 790, y1: 279, x2: 570,  y2: 355, label: "routes to",    appearAt: 96  },
  { x1: 790, y1: 279, x2: 1010, y2: 355, label: "routes to",    appearAt: 104 },
  { x1: 570, y1: 479, x2: 790,  y2: 560, label: "reads/writes", appearAt: 112 },
  { x1: 1010,y1: 479, x2: 790,  y2: 560, label: "reads/writes", appearAt: 120 },
  { x1: 1080,y1: 417, x2: 1330, y2: 297, label: "stores assets",appearAt: 128 },
  { x1: 1080,y1: 479, x2: 1330, y2: 517, label: "logs",         appearAt: 136 },
] as const;

const FF = '"DM Sans", system-ui, sans-serif';

export const Scene3Generation: React.FC = () => {
  const frame = useCurrentFrame();

  // Camera: subtle zoom-in over full scene
  const camScale = interpolate(frame, [0, 210], [0.97, 1.01], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // "Building..." label
  const buildingOpacity = interpolate(frame, [0, 10, 150, 168], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Blinking cursor on the building label
  const cursorVisible = Math.floor(frame / 14) % 2 === 0;

  // "Architecture ready" badge
  const readyOpacity = interpolate(frame, [165, 180], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c", overflow: "hidden" }}>
      {/* Dot grid background */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <pattern id="dots-gen3" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="14" cy="14" r="1.4" fill="rgba(255,255,255,0.04)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots-gen3)" />
      </svg>

      {/* Scene content with camera zoom */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${camScale})`,
          transformOrigin: "center center",
        }}
      >
        {/* VPC dashed frame */}
        <VpcFrame appearAt={0} />

        {/* Edges (below nodes) */}
        <svg style={{ position: "absolute", inset: 0, overflow: "visible", zIndex: 2 }}>
          {EDGES.map((edge, i) => (
            <DiagramEdge key={i} {...edge} />
          ))}
        </svg>

        {/* Nodes */}
        <div style={{ position: "absolute", inset: 0, zIndex: 3 }}>
          {NODES.map((node, i) => (
            <DiagramNode key={node.id} {...node} appearAt={NODE_APPEAR[i]} />
          ))}
        </div>
      </div>

      {/* "Building..." status */}
      {buildingOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 64,
            left: "50%",
            transform: "translateX(-50%)",
            opacity: buildingOpacity,
            color: "#6b7280",
            fontSize: 15,
            fontFamily: FF,
            letterSpacing: "0.04em",
            display: "flex",
            alignItems: "center",
            gap: 6,
            zIndex: 10,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: "#3b82f6",
              opacity: cursorVisible ? 1 : 0.2,
            }}
          />
          Building your architecture...
        </div>
      )}

      {/* "Architecture ready" badge */}
      {readyOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 64,
            left: "50%",
            transform: "translateX(-50%)",
            opacity: readyOpacity,
            color: "#22c55e",
            fontSize: 14,
            fontFamily: FF,
            letterSpacing: "0.06em",
            display: "flex",
            alignItems: "center",
            gap: 7,
            zIndex: 10,
          }}
        >
          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", backgroundColor: "#22c55e" }} />
          Architecture ready
        </div>
      )}
    </AbsoluteFill>
  );
};
