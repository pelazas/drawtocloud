import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

const MONO = '"SF Mono","Fira Code","Cascadia Code",monospace';

interface Props {
  appearAt: number;
}

export const VpcFrame: React.FC<Props> = ({ appearAt }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [appearAt, appearAt + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scale = interpolate(frame, [appearAt, appearAt + 18], [0.96, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 440,
        top: 95,
        width: 730,
        height: 630,
        border: "1.5px dashed rgba(59,130,246,0.45)",
        borderRadius: 14,
        backgroundColor: "rgba(59,130,246,0.025)",
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
        zIndex: 1,
        fontFamily: MONO,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 14,
          top: 10,
          color: "#60a5fa",
          fontSize: 11,
          letterSpacing: "0.1em",
          fontWeight: 500,
          opacity: 0.8,
        }}
      >
        VPC
      </div>
    </div>
  );
};
