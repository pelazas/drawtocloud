import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { CanvasArea } from "./CanvasArea";
import { ChatPanel } from "./ChatPanel";
import { TemplatesPanel } from "./TemplatesPanel";

const FF = '"DM Sans", system-ui, sans-serif';

const SparklesIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
    <path d="M19 3l.6 1.8L21.4 5.4l-1.8.6L19 8l-.6-1.8L16.6 5.4l1.8-.6L19 3z" />
  </svg>
);

const NAV_BTN: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "rgba(31,41,55,0.9)", color: "#e5e7eb",
  border: "1px solid rgba(55,65,81,0.8)", borderRadius: 10,
  padding: "7px 12px", fontSize: 12, fontWeight: 700,
  letterSpacing: "0.07em", textTransform: "uppercase",
  fontFamily: FF, whiteSpace: "nowrap",
};

interface Props { clickFrame?: number }

export const AppShell: React.FC<Props> = ({ clickFrame = 52 }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  const btnScale = (frame >= clickFrame && frame < clickFrame + 12)
    ? interpolate(frame, [clickFrame, clickFrame + 5, clickFrame + 12], [1, 0.92, 1], {
        extrapolateLeft: "clamp", extrapolateRight: "clamp",
      })
    : 1;

  return (
    <div style={{ width: 1920, height: 1080, background: "#02040c", fontFamily: FF, opacity }}>
      {/* Navbar */}
      <div style={{
        height: 52, borderBottom: "1px solid rgba(55,65,81,0.5)",
        background: "rgba(17,24,39,0.95)",
        display: "flex", alignItems: "center", paddingLeft: 16, paddingRight: 16, gap: 8,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginRight: 4, letterSpacing: "0.02em" }}>drawtocloud</span>

        {/* NEW ARCHITECTURE — zoom target */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "#2563eb", color: "#fff", borderRadius: 10,
          padding: "7px 12px", fontSize: 12, fontWeight: 700,
          letterSpacing: "0.07em", textTransform: "uppercase",
          transform: `scale(${btnScale})`, transformOrigin: "center", fontFamily: FF,
        }}>
          <SparklesIcon /> New Architecture
        </div>

        {["Templates", "My Designs", "Auto Layout"].map((l) => (
          <div key={l} style={NAV_BTN}>{l}</div>
        ))}

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#93c5fd", marginRight: 8 }}>Unlimited generations</span>
        {["Save", "Generate Terraform"].map((l) => (
          <div key={l} style={NAV_BTN}>{l}</div>
        ))}
        <div style={{ width: 30, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 17 }}>⚙</div>
        <span style={{ fontSize: 12, color: "#e5e7eb" }}>charlypep11@gmai...</span>
      </div>

      {/* Body: Chat | Canvas | Templates */}
      <div style={{ display: "flex", height: 1028 }}>
        <ChatPanel />
        <CanvasArea />
        <TemplatesPanel />
      </div>
    </div>
  );
};
