import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FF, MONO } from "./constants";

const item = (frame: number, fps: number, delay: number) => {
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: 28, stiffness: 120 },
    durationInFrames: 22,
  });
  return {
    opacity: p,
    scale: interpolate(p, [0, 1], [0.92, 1]),
  };
};

export const SceneOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const o = interpolate(frame, [60, 90], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glow = interpolate(frame, [0, 90], [200, 400], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const eyebrow = item(frame, fps, 0);
  const title = item(frame, fps, 12);
  const sub = item(frame, fps, 24);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#02040c",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: FF,
        opacity: o,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: glow * 2,
          height: glow * 2,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(99,102,241,0.08), rgba(99,102,241,0))",
          left: "50%",
          top: "60%",
          transform: "translate(-50%, -50%)",
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, position: "relative" }}>
        <div style={{ fontFamily: MONO, fontSize: 14, color: "#3b82f6", letterSpacing: "0.15em", textTransform: "uppercase", opacity: eyebrow.opacity, transform: `scale(${eyebrow.scale})` }}>drawtocloud</div>
        <div style={{ fontSize: 72, fontWeight: 700, color: "#fff", letterSpacing: "-0.03em", opacity: title.opacity, transform: `scale(${title.scale})` }}>
          draw
          <span style={{ fontWeight: 900 }}>to</span>
          cloud
        </div>
        <div style={{ fontSize: 32, color: "#94a3b8", opacity: sub.opacity, transform: `scale(${sub.scale})` }}>5 generations free. Try now!</div>
      </div>
    </AbsoluteFill>
  );
};
