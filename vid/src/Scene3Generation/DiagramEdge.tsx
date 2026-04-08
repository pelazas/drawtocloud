import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

const FF = '"DM Sans", system-ui, sans-serif';

interface Props {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  appearAt: number;
  drawDuration?: number;
}

export const DiagramEdge: React.FC<Props> = ({
  x1, y1, x2, y2, label, appearAt, drawDuration = 22,
}) => {
  const frame = useCurrentFrame();

  const progress = interpolate(frame, [appearAt, appearAt + drawDuration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const currentX2 = x1 + progress * (x2 - x1);
  const currentY2 = y1 + progress * (y2 - y1);

  const labelOpacity = interpolate(
    frame,
    [appearAt + drawDuration + 2, appearAt + drawDuration + 12],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  if (progress === 0) return null;

  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={currentX2}
        y2={currentY2}
        stroke="#374151"
        strokeWidth={1.5}
        strokeDasharray="6 5"
        strokeLinecap="round"
      />
      {labelOpacity > 0 && (
        <>
          <rect
            x={midX - 34}
            y={midY - 18}
            width={68}
            height={16}
            rx={4}
            fill="rgba(2,4,12,0.85)"
          />
          <text
            x={midX}
            y={midY - 6}
            fill="#9ca3af"
            fontSize={11}
            fontFamily={FF}
            textAnchor="middle"
            opacity={labelOpacity}
          >
            {label}
          </text>
        </>
      )}
    </g>
  );
};
