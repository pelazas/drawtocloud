import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

const MONO = '"SF Mono","Fira Code","Cascadia Code",monospace';

// Covers: ALB (720–930), EC2a (300–510), EC2b (1140–1350), RDS (720–930)
// Horizontally: full diagram (incl. S3/CW at 1490–1700) centered on 1920 → center=960
// Vertically: equal gap from VPC top→canvas top and VPC bottom→status text top (~85px each)
export const VPC_X = 220;
export const VPC_Y = 62;
export const VPC_W = 1210;
export const VPC_H = 878;

interface Props {
  appearAt: number;
}

export const VpcFrame: React.FC<Props> = ({ appearAt }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [appearAt, appearAt + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scale = interpolate(frame, [appearAt, appearAt + 20], [0.97, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: VPC_X,
        top: VPC_Y,
        width: VPC_W,
        height: VPC_H,
        border: "1.5px dashed rgba(59,130,246,0.45)",
        borderRadius: 16,
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
          left: 16,
          top: 12,
          color: "#60a5fa",
          fontSize: 18,
          letterSpacing: "0.12em",
          fontWeight: 600,
          opacity: 0.8,
        }}
      >
        VPC
      </div>
    </div>
  );
};
