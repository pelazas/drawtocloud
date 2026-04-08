import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { DiagramEdge } from "./DiagramEdge";
import { DiagramNode } from "./DiagramNode";
import { VpcFrame } from "./VpcFrame";

// Canvas: 1920×1080  |  Node size: 210×190
// Horizontal: full diagram (VPC x=220 to S3/CW right=1700) centered → center=960 ✓
// Vertical: VPC y=62, h=878 → top gap=62, bottom gap to text=62 (equal) ✓
//
// Node (x,y) = top-left  |  center = (x+105, y+95)
//
// ALB:  x=720,  y=126  →  bottom-center = (825, 316)
// EC2a: x=300,  y=406  →  top=(405,406)  bottom=(405,596)  right=(510,501)
// EC2b: x=1140, y=406  →  top=(1245,406) bottom=(1245,596) right=(1350,501)
// RDS:  x=720,  y=686  →  top-center = (825, 686)
// S3:   x=1490, y=130  →  left-center = (1490, 225)
// CW:   x=1490, y=476  →  left-center = (1490, 571)

const NODES = [
  { id: "alb",  label: "Load Balancer",  sublabel: "ALB",        category: "compute",    serviceType: "alb",        x: 720,  y: 126 },
  { id: "ec2a", label: "EC2 Instance",   sublabel: "App Server", category: "compute",    serviceType: "ec2",        x: 300,  y: 406 },
  { id: "ec2b", label: "EC2 Instance",   sublabel: "App Server", category: "compute",    serviceType: "ec2",        x: 1140, y: 406 },
  { id: "rds",  label: "RDS PostgreSQL", sublabel: "db.t3.med",  category: "database",   serviceType: "rds",        x: 720,  y: 686 },
  { id: "s3",   label: "S3 Bucket",      sublabel: "Assets",     category: "storage",    serviceType: "s3",         x: 1490, y: 130 },
  { id: "cw",   label: "CloudWatch",     sublabel: "Monitoring", category: "monitoring", serviceType: "cloudwatch", x: 1490, y: 476 },
] as const;

const NODE_APPEAR = [8, 24, 38, 52, 66, 80] as const;

const EDGES = [
  { x1: 825,  y1: 316, x2: 405,  y2: 406, label: "routes to",    appearAt: 96  },
  { x1: 825,  y1: 316, x2: 1245, y2: 406, label: "routes to",    appearAt: 104 },
  { x1: 405,  y1: 596, x2: 825,  y2: 686, label: "reads/writes", appearAt: 112 },
  { x1: 1245, y1: 596, x2: 825,  y2: 686, label: "reads/writes", appearAt: 120 },
  { x1: 1350, y1: 501, x2: 1490, y2: 225, label: "stores assets",appearAt: 128 },
  { x1: 1490, y1: 225, x2: 510,  y2: 501, label: "serves files", appearAt: 136 },
] as const;

const FF = '"DM Sans", system-ui, sans-serif';

export const Scene3Generation: React.FC = () => {
  const frame = useCurrentFrame();

  const camScale = interpolate(frame, [0, 210], [0.97, 1.01], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const buildingOpacity = interpolate(frame, [0, 10, 150, 168], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorVisible = Math.floor(frame / 14) % 2 === 0;

  const readyOpacity = interpolate(frame, [165, 180], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c", overflow: "hidden" }}>
      {/* Dot grid */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <pattern id="dots-gen3" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="14" cy="14" r="1.4" fill="rgba(255,255,255,0.04)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots-gen3)" />
      </svg>

      {/* Diagram with subtle camera zoom */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${camScale})`,
          transformOrigin: "center center",
        }}
      >
        <VpcFrame appearAt={0} />

        <svg style={{ position: "absolute", inset: 0, overflow: "visible", zIndex: 2 }}>
          {EDGES.map((edge, i) => (
            <DiagramEdge key={i} {...edge} />
          ))}
        </svg>

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
            bottom: 52,
            left: "50%",
            transform: "translateX(-50%)",
            opacity: buildingOpacity,
            color: "#6b7280",
            fontSize: 20,
            fontFamily: FF,
            letterSpacing: "0.04em",
            display: "flex",
            alignItems: "center",
            gap: 10,
            whiteSpace: "nowrap",
            zIndex: 10,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
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
            bottom: 52,
            left: "50%",
            transform: "translateX(-50%)",
            opacity: readyOpacity,
            color: "#22c55e",
            fontSize: 20,
            fontFamily: FF,
            letterSpacing: "0.06em",
            display: "flex",
            alignItems: "center",
            gap: 10,
            whiteSpace: "nowrap",
            zIndex: 10,
          }}
        >
          <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", backgroundColor: "#22c55e" }} />
          Architecture ready
        </div>
      )}
    </AbsoluteFill>
  );
};
