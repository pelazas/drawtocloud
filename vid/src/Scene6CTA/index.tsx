import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const FF = '"DM Sans", system-ui, sans-serif';
const MONO = '"SF Mono","Fira Code","Cascadia Code",monospace';

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

export const Scene6CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glow = interpolate(frame, [0, 90], [200, 420], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const eyebrow = item(frame, fps, 0);
  const wordmark = item(frame, fps, 12);
  const tagline = item(frame, fps, 26);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#02040c",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: FF,
      }}
    >
      {/* Radial glow bloom */}
      <div
        style={{
          position: "absolute",
          width: glow * 2,
          height: glow * 2,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(249,115,22,0.07), rgba(249,115,22,0))",
          left: "50%",
          top: "60%",
          transform: "translate(-50%, -50%)",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          position: "relative",
        }}
      >
        {/* Eyebrow label */}
        <div
          style={{
            fontFamily: MONO,
            fontSize: 14,
            color: "#3b82f6",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            opacity: eyebrow.opacity,
            transform: `scale(${eyebrow.scale})`,
          }}
        >
          drawtocloud
        </div>

        {/* Wordmark */}
        <div
          style={{
            fontSize: 88,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            opacity: wordmark.opacity,
            transform: `scale(${wordmark.scale})`,
          }}
        >
          <span style={{ color: "#94a3b8" }}>draw</span>
          <span style={{ color: "#ffffff", fontWeight: 900 }}>to</span>
          <span style={{ color: "#94a3b8" }}>cloud</span>
        </div>

        {/* Tagline */}
        <div
          style={{
            marginTop: 4,
            fontSize: 42,
            fontWeight: 600,
            opacity: tagline.opacity,
            transform: `scale(${tagline.scale})`,
          }}
        >
          <span style={{ color: "#fff" }}>5 generations </span>
          <span style={{ color: "#f97316" }}>free.</span>
          <span style={{ color: "#94a3b8" }}> Try now →</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
