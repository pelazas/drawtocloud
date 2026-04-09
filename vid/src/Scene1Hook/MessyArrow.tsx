import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface Props {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cpOffsetX: number;
  cpOffsetY: number;
  appearAt: number;
}

export const MessyArrow: React.FC<Props> = ({
  x1, y1, x2, y2, cpOffsetX, cpOffsetY, appearAt,
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [appearAt, appearAt + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cpX = (x1 + x2) / 2 + cpOffsetX;
  const cpY = (y1 + y2) / 2 + cpOffsetY;
  const d = `M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}`;

  // Tiny arrowhead at endpoint
  const angle = Math.atan2(y2 - cpY, x2 - cpX);
  const headLen = 10;
  const ax1 = x2 - headLen * Math.cos(angle - 0.4);
  const ay1 = y2 - headLen * Math.sin(angle - 0.4);
  const ax2 = x2 - headLen * Math.cos(angle + 0.4);
  const ay2 = y2 - headLen * Math.sin(angle + 0.4);

  return (
    <g opacity={opacity}>
      <path
        d={d}
        stroke="rgba(0,0,0,0.18)"
        strokeWidth={1.8}
        strokeDasharray="6 4"
        fill="none"
      />
      <line x1={ax1} y1={ay1} x2={x2} y2={y2} stroke="rgba(0,0,0,0.18)" strokeWidth={1.8} />
      <line x1={ax2} y1={ay2} x2={x2} y2={y2} stroke="rgba(0,0,0,0.18)" strokeWidth={1.8} />
    </g>
  );
};
