import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { VpcFrame } from "../Scene3Generation/VpcFrame";
import { MorphingNode } from "./MorphingNode";
import { MorphingEdge } from "./MorphingEdge";
import { ChatPanelIteration } from "./ChatPanelIteration";

// Canvas: 1920×1080  |  Node size: 210×190

const FF = '"DM Sans", system-ui, sans-serif';

// ── Cursor SVG ────────────────────────────────────────────────────
const CursorSVG = () => (
  <svg width="24" height="30" viewBox="0 0 30 38" fill="none">
    <path
      d="M3 2 L3 30 L10 22 L15 34 L19 32 L14 20 L24 20 Z"
      fill="white"
      stroke="#1e293b"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);

// ── Node definitions ──────────────────────────────────────────────
const BEFORE_NODES = [
  { id: "alb",  label: "Load Balancer",   sublabel: "ALB",         category: "compute",    serviceType: "alb"        },
  { id: "ec2a", label: "EC2 Instance",    sublabel: "App Server",  category: "compute",    serviceType: "ec2"        },
  { id: "ec2b", label: "EC2 Instance",    sublabel: "App Server",  category: "compute",    serviceType: "ec2"        },
  { id: "rds",  label: "RDS PostgreSQL",  sublabel: "db.t3.med",   category: "database",   serviceType: "rds"        },
  { id: "s3",   label: "S3 Bucket",       sublabel: "Assets",      category: "storage",    serviceType: "s3"         },
  { id: "cw",   label: "CloudWatch",      sublabel: "Monitoring",  category: "monitoring", serviceType: "cloudwatch" },
];

const AFTER_NODES = [
  { id: "alb",  label: "API Gateway",     sublabel: "REST API",  category: "network",    serviceType: "apigateway" },
  { id: "ec2a", label: "Lambda Function", sublabel: "user-svc",  category: "compute",    serviceType: "lambda"     },
  { id: "ec2b", label: "Lambda Function", sublabel: "order-svc", category: "compute",    serviceType: "lambda"     },
  { id: "rds",  label: "DynamoDB",        sublabel: "NoSQL",     category: "database",   serviceType: "dynamodb"   },
  { id: "s3",   label: "S3 Bucket",       sublabel: "Assets",    category: "storage",    serviceType: "s3"         },
  { id: "cw",   label: "CloudWatch",      sublabel: "Monitoring",category: "monitoring", serviceType: "cloudwatch" },
];

const NODE_POSITIONS = [
  { x: 720,  y: 126 },
  { x: 300,  y: 406 },
  { x: 1140, y: 406 },
  { x: 720,  y: 686 },
  { x: 1490, y: 130 },
  { x: 1490, y: 476 },
];

// Node morph timings — staggered 12f apart, dramatic
const MORPH_ATS = [290, 302, 314, 326, -1, -1];

// ── Edges (same geometry, only labels change) ─────────────────────
const EDGES = [
  { x1: 825,  y1: 316, x2: 405,  y2: 406, labelBefore: "routes to",     labelAfter: "invokes",       morphAt: 340 },
  { x1: 825,  y1: 316, x2: 1245, y2: 406, labelBefore: "routes to",     labelAfter: "invokes",       morphAt: 340 },
  { x1: 405,  y1: 596, x2: 825,  y2: 686, labelBefore: "reads/writes",  labelAfter: "reads/writes",  morphAt: 345 },
  { x1: 1245, y1: 596, x2: 825,  y2: 686, labelBefore: "reads/writes",  labelAfter: "reads/writes",  morphAt: 345 },
  { x1: 1350, y1: 501, x2: 1490, y2: 225, labelBefore: "stores assets", labelAfter: "stores assets", morphAt: 350 },
];

// ── Timing constants ──────────────────────────────────────────────
const SLIDE_IN_START  = 15;
const SLIDE_IN_END    = 30;
const SLIDE_OUT_START = 370;
const SLIDE_OUT_END   = 385;

const TYPEWRITE_START   = 50;
const TYPEWRITE_END     = 80;
const SEND_CLICK_AT     = 118;   // cursor clicks send
const LOADING_START     = 135;
const LOADING_END       = 175;
const PLAN_START        = 185;
const IMPL_BTN_AT       = 215;
const CLICK_BTN_AT      = 273;   // cursor clicks implement

// Cursor phases (single cursor for entire scene)
// Phase 1: send button click
const SEND_CURSOR_APPEAR  = 90;
const SEND_CURSOR_CLICK   = 118;
const SEND_CURSOR_DISAPPEAR = 128;
// Phase 2: implement button click
const IMPL_CURSOR_APPEAR  = 237;
const IMPL_CURSOR_CLICK   = 263;
const IMPL_CURSOR_DISAPPEAR = 275;

export const Scene4Iteration: React.FC = () => {
  const frame = useCurrentFrame();

  // ── Unified chat/diagram movement ──────────────────────────────
  // Slide in:  chat -360 → 0, diagram 0 → 180
  // Stay:      chat 0,     diagram 180
  // Slide out: chat 0 → -400, diagram 180 → 0

  const chatTranslateX = (() => {
    if (frame < SLIDE_IN_START) return -360;
    if (frame < SLIDE_IN_END) {
      return interpolate(
        frame,
        [SLIDE_IN_START, SLIDE_IN_END],
        [-360, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      );
    }
    if (frame < SLIDE_OUT_START) return 0;
    if (frame < SLIDE_OUT_END) {
      return interpolate(
        frame,
        [SLIDE_OUT_START, SLIDE_OUT_END],
        [0, -400],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      );
    }
    return -400;
  })();

  const diagramTranslateX = (() => {
    if (frame < SLIDE_IN_START) return 0;
    if (frame < SLIDE_IN_END) {
      return interpolate(
        frame,
        [SLIDE_IN_START, SLIDE_IN_END],
        [0, 180],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      );
    }
    if (frame < SLIDE_OUT_START) return 180;
    if (frame < SLIDE_OUT_END) {
      return interpolate(
        frame,
        [SLIDE_OUT_START, SLIDE_OUT_END],
        [180, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      );
    }
    return 0;
  })();

  // ── Single cursor: position + opacity ──────────────────────────
  // Phase 1: send cursor (110–148)
  // Phase 2: implement cursor (267–305)
  // Otherwise: hidden

  const isSendPhase = frame >= SEND_CURSOR_APPEAR && frame < SEND_CURSOR_DISAPPEAR;
  const isImplPhase = frame >= IMPL_CURSOR_APPEAR && frame < IMPL_CURSOR_DISAPPEAR;
  const cursorVisible = isSendPhase || isImplPhase;

  let cursorX = 0;
  let cursorY = 0;
  let cursorOpacity = 0;
  let cursorScale = 1;

  if (isSendPhase) {
    const local = frame - SEND_CURSOR_APPEAR;
    // Fade in
    cursorOpacity = interpolate(local, [0, 5], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
    // Move from upper-right of chat panel to send button
    // Send button is at roughly x=310, y=1010 in panel coords
    cursorX = interpolate(local, [0, 22], [220, 320], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    cursorY = interpolate(local, [0, 22], [960, 1040], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    // Click press at SEND_CURSOR_CLICK
    const clickLocal = frame - SEND_CURSOR_CLICK;
    if (clickLocal >= 0 && clickLocal < 6) {
      cursorScale = interpolate(clickLocal, [0, 3, 6], [1, 0.75, 1], {
        extrapolateLeft: "clamp", extrapolateRight: "clamp",
      });
    }
    // Fade out
    const fadeOutStart = SEND_CURSOR_DISAPPEAR - 8;
    if (frame >= fadeOutStart) {
      cursorOpacity = interpolate(frame, [fadeOutStart, SEND_CURSOR_DISAPPEAR], [1, 0], {
        extrapolateLeft: "clamp", extrapolateRight: "clamp",
      });
    }
  }

  if (isImplPhase) {
    const local = frame - IMPL_CURSOR_APPEAR;
    // Fade in
    cursorOpacity = interpolate(local, [0, 5], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
    // Move from upper area of chat panel to implement button center
    // Button is roughly at x=180 (center), y=850 (below plan message)
    cursorX = interpolate(local, [0, 20], [250, 150], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    cursorY = interpolate(local, [0, 20], [860, 440], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    // Click press at IMPL_CURSOR_CLICK
    const clickLocal = frame - IMPL_CURSOR_CLICK;
    if (clickLocal >= 0 && clickLocal < 6) {
      cursorScale = interpolate(clickLocal, [0, 3, 6], [1, 0.75, 1], {
        extrapolateLeft: "clamp", extrapolateRight: "clamp",
      });
    }
    // Fade out
    const fadeOutStart = IMPL_CURSOR_DISAPPEAR - 8;
    if (frame >= fadeOutStart) {
      cursorOpacity = interpolate(frame, [fadeOutStart, IMPL_CURSOR_DISAPPEAR], [1, 0], {
        extrapolateLeft: "clamp", extrapolateRight: "clamp",
      });
    }
  }

  // ── Status text phases ─────────────────────────────────────────
  const statusReadyOpacity = interpolate(
    frame,
    [0, 5, 270, 280],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const statusApplyingOpacity = interpolate(
    frame,
    [280, 290, 330, 340],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const statusDoneOpacity = interpolate(
    frame,
    [350, 360],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const blinkingDot = Math.floor(frame / 14) % 2 === 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c", overflow: "hidden" }}>
      {/* Dot grid */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <pattern id="dots-gen4" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="14" cy="14" r="1.4" fill="rgba(255,255,255,0.04)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots-gen4)" />
      </svg>

      {/* Chat panel */}
      <ChatPanelIteration
        chatTranslateX={chatTranslateX}
        typewriteStart={TYPEWRITE_START}
        typewriteEnd={TYPEWRITE_END}
        sendClickAt={SEND_CLICK_AT}
        loadingStart={LOADING_START}
        loadingEnd={LOADING_END}
        planStart={PLAN_START}
        implementBtnAt={IMPL_BTN_AT}
        clickBtnAt={CLICK_BTN_AT}
      />

      {/* Single cursor (positioned relative to chat panel) */}
      {cursorVisible && cursorOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            left: chatTranslateX + cursorX,
            top: cursorY,
            opacity: cursorOpacity,
            transform: `scale(${cursorScale})`,
            transformOrigin: "4px 4px",
            pointerEvents: "none",
            zIndex: 50,
          }}
        >
          <CursorSVG />
        </div>
      )}

      {/* Diagram group */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateX(${diagramTranslateX}px)`,
        }}
      >
        {/* VPC frame — already drawn */}
        <VpcFrame appearAt={-999} />

        {/* Edges — always drawn, only labels morph */}
        <svg
          style={{
            position: "absolute",
            inset: 0,
            overflow: "visible",
            zIndex: 2,
          }}
        >
          {EDGES.map((edge, i) => (
            <MorphingEdge key={i} {...edge} />
          ))}
        </svg>

        {/* Nodes */}
        <div style={{ position: "absolute", inset: 0, zIndex: 3 }}>
          {BEFORE_NODES.map((node, i) => {
            const pos = NODE_POSITIONS[i];
            const morphAt = MORPH_ATS[i];

            if (morphAt < 0) {
              return (
                <MorphingNode
                  key={node.id}
                  beforeLabel={node.label}
                  beforeSublabel={node.sublabel}
                  beforeCategory={node.category}
                  beforeServiceType={node.serviceType}
                  afterLabel={node.label}
                  afterSublabel={node.sublabel}
                  afterCategory={node.category}
                  afterServiceType={node.serviceType}
                  x={pos.x}
                  y={pos.y}
                  morphAt={-999}
                  alreadyVisible
                />
              );
            }

            const after = AFTER_NODES[i];
            return (
              <MorphingNode
                key={node.id}
                beforeLabel={node.label}
                beforeSublabel={node.sublabel}
                beforeCategory={node.category}
                beforeServiceType={node.serviceType}
                afterLabel={after.label}
                afterSublabel={after.sublabel}
                afterCategory={after.category}
                afterServiceType={after.serviceType}
                x={pos.x}
                y={pos.y}
                morphAt={morphAt}
                alreadyVisible
              />
            );
          })}
        </div>
      </div>

      {/* ── Status text ──────────────────────────────────────── */}

      {statusReadyOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 52,
            left: "50%",
            transform: `translateX(calc(-50% + ${diagramTranslateX}px))`,
            opacity: statusReadyOpacity,
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
          <span
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              borderRadius: "50%",
              backgroundColor: "#22c55e",
            }}
          />
          Architecture ready
        </div>
      )}

      {statusApplyingOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 52,
            left: "50%",
            transform: `translateX(calc(-50% + ${diagramTranslateX}px))`,
            opacity: statusApplyingOpacity,
            color: "#3b82f6",
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
              opacity: blinkingDot ? 1 : 0.2,
            }}
          />
          Applying changes...
        </div>
      )}

      {statusDoneOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 52,
            left: "50%",
            transform: `translateX(calc(-50% + ${diagramTranslateX}px))`,
            opacity: statusDoneOpacity,
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
          <span
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              borderRadius: "50%",
              backgroundColor: "#22c55e",
            }}
          />
          Serverless architecture ready ✓
        </div>
      )}
    </AbsoluteFill>
  );
};
