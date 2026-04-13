import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { VpcFrame } from "../Scene3Generation/VpcFrame";
import { DiagramNode } from "../Scene3Generation/DiagramNode";
import { DiagramEdge } from "../Scene3Generation/DiagramEdge";
import { ExportPanel } from "./ExportPanel";
import { Cursor } from "./Cursor";

const FF = '"DM Sans", system-ui, sans-serif';

// ── Timing constants ──────────────────────────────────────────────
const HOLD_END = 10;
const SLIDE_START = 10;
const SLIDE_END = 30;
const CODE_FADE_IN = 40;
const CODE_HIDE_AT = 135;
const CURSOR_APPEAR = 100;
const CURSOR_ARRIVE = 125;
const CURSOR_CLICK = 135;
const CURSOR_CLICK_END = 142;
const CURSOR_FADE_END = 150;
const TAB_SWITCH_START = 137;
const TAB_SWITCH_END = 152;
const COST_FADE_IN = 137;
const COST_COUNT_UP = 152;
const COST_COUNT_END = 190;

// ── Serverless nodes (Scene 4's AFTER state) ──────────────────────
const NODES = [
  { id: "alb",  label: "API Gateway",      sublabel: "REST API",   category: "network",    serviceType: "apigateway", x: 720,  y: 126 },
  { id: "ec2a", label: "Lambda Function",  sublabel: "user-svc",   category: "compute",    serviceType: "lambda",     x: 300,  y: 406 },
  { id: "ec2b", label: "Lambda Function",  sublabel: "order-svc",  category: "compute",    serviceType: "lambda",     x: 1140, y: 406 },
  { id: "rds",  label: "DynamoDB",         sublabel: "NoSQL",      category: "database",   serviceType: "dynamodb",   x: 720,  y: 686 },
  { id: "s3",   label: "S3 Bucket",        sublabel: "Assets",     category: "storage",    serviceType: "s3",         x: 1490, y: 130 },
  { id: "cw",   label: "CloudWatch",       sublabel: "Monitoring", category: "monitoring", serviceType: "cloudwatch", x: 1490, y: 476 },
];

// ── Edges (serverless labels, always visible) ─────────────────────
const EDGES = [
  { x1: 825,  y1: 316, x2: 405,  y2: 406, label: "invokes",      appearAt: -999 },
  { x1: 825,  y1: 316, x2: 1245, y2: 406, label: "invokes",      appearAt: -999 },
  { x1: 405,  y1: 596, x2: 825,  y2: 686, label: "reads/writes", appearAt: -999 },
  { x1: 1245, y1: 596, x2: 825,  y2: 686, label: "reads/writes", appearAt: -999 },
  { x1: 1350, y1: 501, x2: 1490, y2: 225, label: "stores assets",appearAt: -999 },
];

// Cursor targets (global coords, panel is on the right)
const PANEL_W = 520;
const CURSOR_CLICK_X = 1920 - PANEL_W + 170; // Cost Estimate tab position
const CURSOR_START_Y = 20;
const CURSOR_TAB_Y = 52;

// ── Dot grid ──────────────────────────────────────────────────────
const DotGrid: React.FC = () => (
  <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
    <defs>
      <pattern id="dots-gen5" width="28" height="28" patternUnits="userSpaceOnUse">
        <circle cx="14" cy="14" r="1.4" fill="rgba(255,255,255,0.04)" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#dots-gen5)" />
  </svg>
);

export const Scene5Export: React.FC = () => {
  const frame = useCurrentFrame();

  // ── Diagram shift: 0 → -100 (slides left to make room for right panel) ──
  const diagramTranslateX = interpolate(
    frame,
    [SLIDE_START, SLIDE_END],
    [0, -100],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  // ── Right panel slide: 520 → 0 (slides in from right) ─────────
  const panelSlideX = interpolate(
    frame,
    [SLIDE_START, SLIDE_END],
    [PANEL_W, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  // ── Status text ────────────────────────────────────────────
  // Phase 1: "Generating terraform code..." (blue, blinking dot) — frames 0→CODE_HIDE_AT
  const statusGenOpacity = interpolate(
    frame,
    [0, 4, CODE_HIDE_AT - 4, CODE_HIDE_AT],
    [1, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );
  const blinkingDot = Math.floor(frame / 14) % 2 === 0;

  // Phase 2: "Generating cost estimate..." (blue, blinking dot)
  const statusEstimateOpacity = interpolate(
    frame,
    [137, 141, 217, 221],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  // ── Cursor ──────────────────────────────────────────────────────
  const isCursorVisible = frame >= CURSOR_APPEAR && frame < CURSOR_FADE_END;

  const cursorSlideProgress = interpolate(
    frame,
    [CURSOR_APPEAR, CURSOR_ARRIVE],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.quad),
    }
  );
  const cursorY = interpolate(
    cursorSlideProgress,
    [0, 1],
    [CURSOR_START_Y, CURSOR_TAB_Y]
  );

  // Click press
  const clickLocalFrame = frame - CURSOR_CLICK;
  const clickProgress =
    clickLocalFrame >= 0 && clickLocalFrame < CURSOR_CLICK_END - CURSOR_CLICK
      ? interpolate(clickLocalFrame, [0, 3, 7], [0, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  const cursorClickScale = 1 - clickProgress * 0.25;

  // Fade out
  const cursorOpacity = (() => {
    if (frame < CURSOR_APPEAR) return 0;
    if (frame >= CURSOR_FADE_END) return 0;
    if (frame >= CURSOR_FADE_END - 10) {
      return interpolate(frame, [CURSOR_FADE_END - 10, CURSOR_FADE_END], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    // Fade in
    return interpolate(frame, [CURSOR_APPEAR, CURSOR_APPEAR + 6], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  })();

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c", overflow: "hidden" }}>
      {/* Dot grid */}
      <DotGrid />

      {/* ── Diagram group ─────────────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateX(${diagramTranslateX}px)`,
        }}
      >
        <VpcFrame appearAt={-999} />

        <svg
          style={{
            position: "absolute",
            inset: 0,
            overflow: "visible",
            zIndex: 2,
          }}
        >
          {EDGES.map((edge, i) => (
            <DiagramEdge key={i} {...edge} />
          ))}
        </svg>

        <div style={{ position: "absolute", inset: 0, zIndex: 3 }}>
          {NODES.map((node) => (
            <DiagramNode
              key={node.id}
              label={node.label}
              sublabel={node.sublabel}
              category={node.category}
              serviceType={node.serviceType}
              x={node.x}
              y={node.y}
              appearAt={-999}
            />
          ))}
        </div>
      </div>

      {/* ── Status text: "Generating terraform code..." ───────── */}
      {statusGenOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 52,
            left: "50%",
            transform: `translateX(calc(-50% + ${diagramTranslateX}px))`,
            opacity: statusGenOpacity,
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
          Generating terraform code...
        </div>
      )}

      {/* ── Status text: "Generating cost estimate..." ────────── */}
      {statusEstimateOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 52,
            left: "50%",
            transform: `translateX(calc(-50% + ${diagramTranslateX}px))`,
            opacity: statusEstimateOpacity,
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
          Generating cost estimate...
        </div>
      )}

      {/* ── Right panel ───────────────────────────────────────── */}
      <ExportPanel
        slideX={panelSlideX}
        codeFadeInFrom={CODE_FADE_IN}
        codeHideAt={CODE_HIDE_AT}
        tabSwitchStart={TAB_SWITCH_START}
        tabSwitchEnd={TAB_SWITCH_END}
        costFadeInFrom={COST_FADE_IN}
        costCountUpFrom={COST_COUNT_UP}
        costCountUpEnd={COST_COUNT_END}
      />

      {/* ── Cursor ────────────────────────────────────────────── */}
      {isCursorVisible && cursorOpacity > 0 && (
        <Cursor
          x={CURSOR_CLICK_X}
          y={cursorY}
          opacity={cursorOpacity}
          scale={cursorClickScale}
        />
      )}
    </AbsoluteFill>
  );
};
