import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { CodeContent } from "./CodeContent";
import { CostContent } from "./CostContent";

const FF = '"DM Sans", system-ui, sans-serif';

const INDICATOR_W = 100;
const TAB_TERRAFORM_X = 20;
const TAB_COST_X = 160;

interface Props {
  slideX: number;
  codeFadeInFrom: number;
  codeHideAt: number;
  tabSwitchStart: number;
  tabSwitchEnd: number;
  costFadeInFrom: number;
  costCountUpFrom: number;
  costCountUpEnd: number;
}

export const ExportPanel: React.FC<Props> = ({
  slideX,
  codeFadeInFrom,
  codeHideAt,
  tabSwitchStart,
  tabSwitchEnd,
  costFadeInFrom,
  costCountUpFrom,
  costCountUpEnd,
}) => {
  const frame = useCurrentFrame();

  // Code is visible only before tab switch
  const codeVisible = frame < codeHideAt;

  // Tab indicator slides between tabs
  const indicatorX = interpolate(
    frame,
    [tabSwitchStart, tabSwitchEnd],
    [TAB_TERRAFORM_X, TAB_COST_X],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.quad),
    }
  );

  // Tab text opacities
  const terraformOpacity = interpolate(
    frame,
    [tabSwitchStart, tabSwitchEnd],
    [1, 0.4],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );
  const costOpacity = interpolate(
    frame,
    [tabSwitchStart, tabSwitchEnd],
    [0.4, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        width: 520,
        height: "100%",
        transform: `translateX(${slideX}px)`,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        background: "#0b1020",
        borderLeft: "1px solid #1b2339",
        fontFamily: FF,
      }}
    >
      {/* ── Tab bar ─────────────────────────────────────────── */}
      <div
        style={{
          height: 56,
          borderBottom: "1px solid #1b2339",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 4,
          flexShrink: 0,
          position: "relative",
        }}
      >
        {/* Terraform tab */}
        <div
          style={{
            fontFamily: FF,
            fontSize: 14,
            fontWeight: 500,
            color: `rgba(226,232,240,${terraformOpacity})`,
            padding: "8px 14px",
            borderRadius: "8px 8px 0 0",
            position: "relative",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          Terraform
        </div>

        {/* Cost Estimate tab */}
        <div
          style={{
            fontFamily: FF,
            fontSize: 14,
            fontWeight: 500,
            color: `rgba(226,232,240,${costOpacity})`,
            padding: "8px 14px",
            borderRadius: "8px 8px 0 0",
            position: "relative",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          Cost Estimate
        </div>

        {/* Sliding blue indicator */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: indicatorX,
            width: INDICATOR_W,
            height: 3,
            backgroundColor: "#3b82f6",
            borderRadius: "3px 3px 0 0",
          }}
        />
      </div>

      {/* ── Content area ────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          padding: "12px 16px 16px",
        }}
      >
        <CodeContent
          fadeInFrom={codeFadeInFrom}
          isVisible={codeVisible}
        />
        <CostContent
          fadeInFrom={costFadeInFrom}
          countUpFrom={costCountUpFrom}
          countUpEnd={costCountUpEnd}
        />
      </div>
    </div>
  );
};
