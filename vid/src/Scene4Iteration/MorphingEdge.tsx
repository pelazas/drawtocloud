import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

const FF = '"DM Sans", system-ui, sans-serif';

interface Props {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelBefore: string;
  labelAfter: string;
  morphAt: number; // frame when label starts switching
}

export const MorphingEdge: React.FC<Props> = ({
  x1, y1, x2, y2, labelBefore, labelAfter, morphAt,
}) => {
  const frame = useCurrentFrame();

  // Crossfade labels over 15 frames
  const labelOpacity = interpolate(
    frame,
    [morphAt, morphAt + 15],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <g>
      {/* Line always fully drawn */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="#374151"
        strokeWidth={1.5}
        strokeDasharray="6 5"
        strokeLinecap="round"
      />
      {/* Before label (fading out) */}
      <g opacity={1 - labelOpacity}>
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
        >
          {labelBefore}
        </text>
      </g>
      {/* After label (fading in) */}
      <g opacity={labelOpacity}>
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
        >
          {labelAfter}
        </text>
      </g>
    </g>
  );
};
