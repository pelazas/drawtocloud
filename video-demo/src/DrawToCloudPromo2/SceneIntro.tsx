import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FF } from "./constants";

export const SceneIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleSpring = spring({
    frame,
    fps,
    config: { damping: 28, stiffness: 120 },
    durationInFrames: 24,
  });
  const subSpring = spring({
    frame: frame - 14,
    fps,
    config: { damping: 28, stiffness: 120 },
    durationInFrames: 24,
  });

  const groupOut = interpolate(frame, [72, 90], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(ellipse at 50% 0%, rgb(15,23,42) 0%, rgb(2,4,12) 70%)",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FF,
      }}
    >
      <div style={{ opacity: groupOut, textAlign: "center" }}>
        <div
          style={{
            fontSize: 88,
            fontWeight: 700,
            color: "#fff",
            letterSpacing: "-0.02em",
            transform: `translateY(${interpolate(titleSpring, [0, 1], [20, 0])}px)`,
            opacity: titleSpring,
          }}
        >
          <span style={{ color: "#94a3b8" }}>draw</span>
          <span style={{ color: "#ffffff", fontWeight: 900 }}>to</span>
          <span style={{ color: "#94a3b8" }}>cloud</span>
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 30,
            fontWeight: 400,
            color: "#94a3b8",
            transform: `translateY(${interpolate(subSpring, [0, 1], [20, 0])}px)`,
            opacity: subSpring,
          }}
        >
          Generate cloud infrastructure with AI
        </div>
      </div>
    </AbsoluteFill>
  );
};
