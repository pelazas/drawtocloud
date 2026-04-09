import React from "react";
import { AwsIcon } from "./AwsIcon";
import { MessyArrow } from "./MessyArrow";
import { WarningIcon } from "./WarningIcon";

// All coords relative to content area top-left (1680 × 746)
// Icon size 100×100 → center = x+50, y+50
// Diagram centered: x span 260–1420, center=840 (matches 1680/2)

const ICONS = [
  { id: "alb",    serviceType: "alb",         category: "compute",   x: 840,  y: 50,  appearAt: 0,  jitterPhase: 0.0 },
  { id: "ec2",    serviceType: "ec2",          category: "compute",   x: 420,  y: 110, appearAt: 10, jitterPhase: 0.9, errorLabel: "Connection Timeout" },
  { id: "lambda", serviceType: "lambda",       category: "compute",   x: 1260, y: 60,  appearAt: 20, jitterPhase: 1.8 },
  { id: "rds",    serviceType: "rds",          category: "database",  x: 850,  y: 360, appearAt: 32, jitterPhase: 2.7, errorLabel: "Query Failed" },
  { id: "s3",     serviceType: "s3",           category: "storage",   x: 540,  y: 520, appearAt: 42, jitterPhase: 3.6 },
  { id: "cw",     serviceType: "cloudwatch",   category: "monitoring",x: 1320, y: 370, appearAt: 52, jitterPhase: 4.5 },
  { id: "sqs",    serviceType: "sqs",          category: "compute",   x: 260,  y: 440, appearAt: 60, jitterPhase: 5.4 },
] as const;

const WARNINGS = [
  { id: "w1", x: 690, y: 200, appearAt: 18, jitterPhase: 1.2 },
  { id: "w2", x: 1060, y: 140, appearAt: 28, jitterPhase: 2.1 },
  { id: "w3", x: 720, y: 535, appearAt: 48, jitterPhase: 3.9 },
] as const;

// Centers: ALB(890,100) EC2(470,160) Lambda(1310,110) RDS(900,410) S3(590,570) CW(1370,420) SQS(310,490)
const ARROWS = [
  { x1: 890,  y1: 100, x2: 470,  y2: 160, cpOffsetX: -90, cpOffsetY: -55, appearAt: 6  },
  { x1: 890,  y1: 100, x2: 1310, y2: 110, cpOffsetX:  60, cpOffsetY: -85, appearAt: 16 },
  { x1: 470,  y1: 160, x2: 900,  y2: 410, cpOffsetX: -80, cpOffsetY:  55, appearAt: 28 },
  { x1: 1310, y1: 110, x2: 1370, y2: 420, cpOffsetX:  95, cpOffsetY:  20, appearAt: 38 },
  { x1: 900,  y1: 410, x2: 590,  y2: 570, cpOffsetX: -65, cpOffsetY:  60, appearAt: 46 },
  { x1: 310,  y1: 490, x2: 900,  y2: 410, cpOffsetX: -50, cpOffsetY: -85, appearAt: 54 },
  { x1: 1370, y1: 420, x2: 590,  y2: 570, cpOffsetX:  65, cpOffsetY:  95, appearAt: 60 },
  { x1: 1310, y1: 110, x2: 900,  y2: 410, cpOffsetX:  80, cpOffsetY:  40, appearAt: 66 },
] as const;

export const BrowserContent: React.FC = () => {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#f8fafc" }}>
      {/* Subtle dot grid */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <pattern id="dots-browser" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="12" r="1.2" fill="rgba(0,0,0,0.07)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots-browser)" />
      </svg>

      {/* Arrows */}
      <svg style={{ position: "absolute", inset: 0, overflow: "visible", zIndex: 1 }}>
        {ARROWS.map((a, i) => <MessyArrow key={i} {...a} />)}
      </svg>

      {/* Icons */}
      <div style={{ position: "absolute", inset: 0, zIndex: 2 }}>
        {ICONS.map((icon) => <AwsIcon key={icon.id} {...icon} />)}
      </div>

      {/* Warnings */}
      <div style={{ position: "absolute", inset: 0, zIndex: 3 }}>
        {WARNINGS.map((w) => <WarningIcon key={w.id} {...w} />)}
      </div>
    </div>
  );
};
