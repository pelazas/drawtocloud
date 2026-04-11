import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

const CursorSVG = () => (
  <svg width="30" height="38" viewBox="0 0 30 38" fill="none">
    <path
      d="M3 2 L3 30 L10 22 L15 34 L19 32 L14 20 L24 20 Z"
      fill="white"
      stroke="#1e293b"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);

interface Props { clickFrame: number }

export const Cursor: React.FC<Props> = ({ clickFrame }) => {
  const frame = useCurrentFrame();

  // ── Cursor 1: click the NEW ARCHITECTURE button ──────────────────────────
  const x1 = interpolate(frame, [38, 50], [1520, 965], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const y1 = interpolate(frame, [38, 50], [780, 546], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const opacity1 = interpolate(frame, [35, 39, 63, 70], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const clickScale1 = (frame >= 52 && frame < 64)
    ? interpolate(frame, [52, 56, 64], [1, 0.7, 1], {
        extrapolateLeft: "clamp", extrapolateRight: "clamp",
      })
    : 1;

  // ── Cursor 2: click the Generate Architecture button ─────────────────────
  const x2 = interpolate(frame, [205, 220], [720, 1266], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const y2 = interpolate(frame, [205, 220], [430, 890], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const opacity2 = interpolate(frame, [203, 207, 236, 244], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const clickScale2 = (frame >= clickFrame && frame < clickFrame + 10)
    ? interpolate(frame, [clickFrame, clickFrame + 4, clickFrame + 10], [1, 0.7, 1], {
        extrapolateLeft: "clamp", extrapolateRight: "clamp",
      })
    : 1;

  return (
    <>
      {/* Cursor 1 */}
      <div style={{
        position: "absolute",
        left: x1, top: y1,
        opacity: opacity1,
        transform: `scale(${clickScale1})`,
        transformOrigin: "4px 4px",
        pointerEvents: "none",
        zIndex: 200,
      }}>
        <CursorSVG />
      </div>

      {/* Cursor 2 */}
      <div style={{
        position: "absolute",
        left: x2, top: y2,
        opacity: opacity2,
        transform: `scale(${clickScale2})`,
        transformOrigin: "4px 4px",
        pointerEvents: "none",
        zIndex: 200,
      }}>
        <CursorSVG />
      </div>
    </>
  );
};
