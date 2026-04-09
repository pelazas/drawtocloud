import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
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
// Button is at the bottom-right of the 860px modal (centered at x=960)
// Approx screen coords: x≈1266, y≈890
const GEN_BTN_X = 1266;
const GEN_BTN_Y = 890;
const MAX_ZOOM_GEN = 1.75;
const TX_GEN = 960 - GEN_BTN_X * MAX_ZOOM_GEN;
const TY_GEN = 540 - GEN_BTN_Y * MAX_ZOOM_GEN;

export const Scene2Input: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Zoom 1 in: frames 20-42
  const zoomIn = interpolate(frame, [20, 42], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  // Zoom 1 out: frames 58-66 (fast — 8 frames)
  const zoomOut = interpolate(frame, [58, 66], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });

  const zoomP = zoomIn - zoomOut;
  const zoom  = interpolate(zoomP, [0, 1], [1, MAX_ZOOM]);
  const tx    = interpolate(zoomP, [0, 1], [0, TX_MAX]);
  const ty    = interpolate(zoomP, [0, 1], [0, TY_MAX]);

  // Zoom 2 in: frames 210-222 (cursor approaching Generate button)
  const genZoomIn = interpolate(frame, [210, 222], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  // Zoom 2 out: frames 228-236 (starts zooming out right after click)
  const genZoomOut = interpolate(frame, [228, 236], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });

  const genZoomP = genZoomIn - genZoomOut;
  const zoomGen  = interpolate(genZoomP, [0, 1], [1, MAX_ZOOM_GEN]);
  const txGen    = interpolate(genZoomP, [0, 1], [0, TX_GEN]);
  const tyGen    = interpolate(genZoomP, [0, 1], [0, TY_GEN]);

  // ── Bloom blast (click at frame 222) ──────────────────────────────────────
  // Radial burst that expands from screen center (where the button is at peak zoom)
  const blastP = spring({
    frame: frame - 222, fps,
    config: { damping: 30, stiffness: 180 },
    durationInFrames: 20,
  });
  const blastScale = interpolate(blastP, [0, 1], [0.02, 3]);
  const blastOpacity = interpolate(
    frame,
    [222, 224, 230, 240],
    [0,   1,   0.7,   0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Black fade to end the scene
  const blackOpacity = interpolate(frame, [233, 240], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c", overflow: "hidden" }}>
      {/* Zoom 2 — wraps everything, activates for Generate button click */}
      <div style={{
        position: "absolute", inset: 0,
        transform: `translateX(${txGen}px) translateY(${tyGen}px) scale(${zoomGen})`,
        transformOrigin: "0 0",
      }}>
        {/* Zoom 1 — wraps app shell only, activates for NEW ARCH button click */}
        <div style={{
          position: "absolute", inset: 0,
          transform: `translateX(${tx}px) translateY(${ty}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}>
          <AppShell clickFrame={52} />
        </div>

        {/* Cursor and Modal are in screen space relative to zoom 2 */}
        <Cursor />
        <Modal />
      </div>

      {/* ── Bloom flash — screen space, outside zoom ── */}
      {blastOpacity > 0 && (
        <div style={{
          position: "absolute", inset: 0,
          overflow: "hidden", pointerEvents: "none", zIndex: 300,
        }}>
          <div style={{
            position: "absolute",
            left: "50%", top: "50%",
            width: 2880, height: 2880,
            borderRadius: "50%",
            transform: `translate(-50%, -50%) scale(${blastScale})`,
            background: [
              "radial-gradient(circle,",
              "  rgba(255,255,255,1)    0%,",
              "  rgba(191,219,254,0.95) 8%,",
              "  rgba(96,165,250,0.85)  20%,",
              "  rgba(59,130,246,0.6)   35%,",
              "  rgba(14,24,60,0.35)    55%,",
              "  transparent            75%",
              ")",
            ].join(""),
            opacity: blastOpacity,
          }} />
        </div>
      )}

      {/* Black fade-out to end the scene */}
      {blackOpacity > 0 && (
        <div style={{
          position: "absolute", inset: 0,
          background: "#000",
          opacity: blackOpacity,
          pointerEvents: "none", zIndex: 400,
        }} />
      )}
    </AbsoluteFill>
  );
};
