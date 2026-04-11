import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { AppShell } from "./AppShell";
import { Cursor } from "./Cursor";
import { Modal } from "./Modal";

// ── Zoom 1: toward the NEW ARCHITECTURE button ───────────────────────────────
const BTN_X = 192;
const BTN_Y = 29;
const MAX_ZOOM = 1.9;
const TX_MAX = 960 - BTN_X * MAX_ZOOM;
const TY_MAX = 540 - BTN_Y * MAX_ZOOM;

// ── Zoom 2: toward the Generate Architecture button in the modal ──────────────
const GEN_BTN_X = 1266;
const GEN_BTN_Y = 890;
const MAX_ZOOM_GEN = 1.75;
const TX_GEN = 960 - GEN_BTN_X * MAX_ZOOM_GEN;
const TY_GEN = 540 - GEN_BTN_Y * MAX_ZOOM_GEN;

// ── Transition timing ────────────────────────────────────────────────────────
const CLICK_FRAME = 222;
const BLUR_START = 221;  // start blurring right before the click lands
const BLUR_END = 272;    // fully blurred + faded to black

export const Scene2Input: React.FC = () => {
  const frame = useCurrentFrame();

  // ── Zoom 1 ────────────────────────────────────────────────────────────────
  const zoomIn = interpolate(frame, [20, 42], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const zoomOut = interpolate(frame, [58, 66], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const zoomP = zoomIn - zoomOut;
  const zoom  = interpolate(zoomP, [0, 1], [1, MAX_ZOOM]);
  const tx    = interpolate(zoomP, [0, 1], [0, TX_MAX]);
  const ty    = interpolate(zoomP, [0, 1], [0, TY_MAX]);

  // ── Zoom 2: zoom in to Generate button, stay there ───────────────────────
  const zoomGen  = interpolate(frame, [210, 222], [1, MAX_ZOOM_GEN], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const txGen    = interpolate(frame, [210, 222], [0, TX_GEN], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const tyGen    = interpolate(frame, [210, 222], [0, TY_GEN], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });

  // ── Blur + fade ──────────────────────────────────────────────────────────
  const blurPx = interpolate(frame, [BLUR_START, BLUR_END], [0, 18], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const fadeOpacity = interpolate(frame, [BLUR_START, BLUR_END], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c", overflow: "hidden" }}>
      {/* ── Zoom 2 wrapper ── */}
      <div style={{
        position: "absolute", inset: 0,
        transform: `translateX(${txGen}px) translateY(${tyGen}px) scale(${zoomGen})`,
        transformOrigin: "0 0",
        filter: `blur(${blurPx}px)`,
      }}>
        {/* ── Zoom 1 wrapper (AppShell only) ── */}
        <div style={{
          position: "absolute", inset: 0,
          transform: `translateX(${tx}px) translateY(${ty}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}>
          <AppShell clickFrame={52} />
        </div>

        {/* Cursor — screen space relative to zoom 2 */}
        <Cursor clickFrame={CLICK_FRAME} />

        {/* Modal */}
        <Modal />
      </div>

      {/* ── Black fade-over-blur ── */}
      {fadeOpacity > 0 && (
        <div style={{
          position: "absolute", inset: 0,
          background: "#000",
          opacity: fadeOpacity,
          pointerEvents: "none",
          zIndex: 400,
        }} />
      )}
    </AbsoluteFill>
  );
};
