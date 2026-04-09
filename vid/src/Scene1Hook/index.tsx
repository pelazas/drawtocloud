import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BrowserChrome } from "./BrowserChrome";
import { BrowserContent } from "./BrowserContent";

const FF = '"DM Sans", system-ui, sans-serif';

const BROWSER_W = 1680;
const BROWSER_H = 860;
const BROWSER_X = (1920 - BROWSER_W) / 2; // 120
const BROWSER_Y = 20;

export const Scene1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Browser entrance spring
  const enterP = spring({ frame, fps, config: { damping: 28, stiffness: 120 }, durationInFrames: 24 });
  const browserScale = interpolate(enterP, [0, 1], [0.92, 1]);
  const browserY = interpolate(enterP, [0, 1], [30, 0]);

  // Subtle browser shake — ramps up to ±1.5° as chaos builds
  const shake = Math.sin(frame * 0.4) * interpolate(frame, [0, 60], [0, 1.5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const textOpacity = interpolate(frame, [32, 54], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  const textY = interpolate(frame, [32, 54], [14, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c", overflow: "hidden" }}>
      {/* Dot grid on dark bg */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <pattern id="dots-s1-bg" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="14" cy="14" r="1.4" fill="rgba(255,255,255,0.03)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots-s1-bg)" />
      </svg>

      {/* Browser window */}
      <div
        style={{
          position: "absolute",
          left: BROWSER_X,
          top: BROWSER_Y,
          transform: `scale(${browserScale}) translateY(${browserY}px) rotate(${shake}deg)`,
          transformOrigin: "center top",
        }}
      >
        <BrowserChrome width={BROWSER_W} height={BROWSER_H}>
          <BrowserContent />
        </BrowserChrome>
      </div>

      {/* Headline — outside browser, stays stable */}
      <div
        style={{
          position: "absolute",
          bottom: 52,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: FF,
          fontSize: 56,
          fontWeight: 700,
          color: "#ffffff",
          letterSpacing: "-0.025em",
          opacity: textOpacity,
          transform: `translateY(${textY}px)`,
        }}
      >
        Cloud infrastructure shouldn't be this{" "}
        <span style={{ color: "#ef4444" }}>hard.</span>
      </div>
    </AbsoluteFill>
  );
};
