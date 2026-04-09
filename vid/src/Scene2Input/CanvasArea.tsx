import React from "react";

const FF = '"DM Sans", system-ui, sans-serif';

export const CanvasArea: React.FC = () => (
  <div style={{ flex: 1, height: "100%", background: "#02040c", position: "relative", overflow: "hidden", fontFamily: FF }}>
    {/* Dot grid */}
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <pattern id="dots-canvas" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="1" fill="#374151" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dots-canvas)" />
    </svg>

    {/* Bottom status bar */}
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0, height: 44,
      background: "linear-gradient(180deg,#0b0e1f,#101327,#0b0e1f)",
      borderTop: "1px solid rgba(31,41,55,0.8)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 16px",
    }}>
      <div />
      <span style={{ fontSize: 13, fontWeight: 600, color: "#93c5fd" }}>Generation failed. Try again later..</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>—</span>
        <span style={{ fontSize: 12, color: "#9ca3af", minWidth: 40, textAlign: "center" }}>100%</span>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>+</span>
        <div style={{
          border: "1px solid rgba(59,130,246,0.4)", borderRadius: 8,
          padding: "3px 10px", fontSize: 11, color: "#93c5fd", fontWeight: 600, letterSpacing: "0.06em",
        }}>↺ RESET</div>
      </div>
    </div>
  </div>
);
