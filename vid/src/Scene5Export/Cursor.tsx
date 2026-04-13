import React from "react";

interface CursorProps {
  x: number;
  y: number;
  opacity: number;
  scale?: number;
}

export const Cursor: React.FC<CursorProps> = ({ x, y, opacity, scale = 1 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      opacity,
      transform: `scale(${scale})`,
      transformOrigin: "0 0",
      zIndex: 200,
      pointerEvents: "none",
      filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))",
    }}
  >
    <svg width="24" height="28" viewBox="0 0 24 28" fill="none">
      <path
        d="M1 1L1 22.5L6.5 17.5L11 27L14 25.5L9.5 16L17 16L1 1Z"
        fill="white"
        stroke="#1e293b"
        strokeWidth="1"
      />
    </svg>
  </div>
);
