import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COST_ROWS, FF, MONO, TERRAFORM_LINES } from "./constants";

interface Props {
  startFrame: number;
  switchToCostAt: number;
}

const colorLine = (line: string): string => {
  if (line.startsWith("resource")) return "#ff7b72";
  if (line.includes('"')) return "#a5d6ff";
  if (line.includes("20") || line.includes("15.4")) return "#f0883e";
  return "#e6edf3";
};

export const SceneOutputPanel: React.FC<Props> = ({ startFrame, switchToCostAt }) => {
  const frame = useCurrentFrame() - startFrame;
  const { fps } = useVideoConfig();

  const panelIn = spring({ frame, fps, config: { damping: 20, stiffness: 140 }, durationInFrames: 24 });
  const x = interpolate(panelIn, [0, 1], [760, 0]);
  const activeCost = frame >= switchToCostAt;

  const codeChars = Math.floor(interpolate(frame, [8, 168], [0, TERRAFORM_LINES.join("\n").length], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const typed = TERRAFORM_LINES.join("\n").slice(0, codeChars).split("\n");
  const total = Math.floor(interpolate(frame, [switchToCostAt, switchToCostAt + 30], [0, 47], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const files = ["main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"];

  return (
    <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "30%", background: "#0d1117", borderLeft: "1px solid #21262d", transform: `translateX(${x}px)`, zIndex: 50 }}>
      <div style={{ height: 48, display: "flex", alignItems: "center", gap: 22, padding: "0 18px", fontFamily: FF, fontSize: 14 }}>
        <span style={{ color: activeCost ? "#6b7280" : "#fff", borderBottom: activeCost ? "none" : "2px solid #3b82f6", paddingBottom: 6 }}>Terraform</span>
        <span style={{ color: activeCost ? "#fff" : "#6b7280", borderBottom: activeCost ? "2px solid #3b82f6" : "none", paddingBottom: 6 }}>Cost Estimate</span>
      </div>
      {!activeCost && (
        <div style={{ height: 48, borderTop: "1px solid #1f2937", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", gap: 14, padding: "0 16px", fontFamily: MONO }}>
          {files.map((file, i) => (
            <div
              key={file}
              style={{
                height: 34,
                padding: "0 16px",
                borderRadius: 8,
                border: i === 0 ? "1px solid #334155" : "1px solid transparent",
                backgroundColor: i === 0 ? "rgba(30,41,59,0.8)" : "transparent",
                color: i === 0 ? "#f8fafc" : "#94a3b8",
                display: "flex",
                alignItems: "center",
                fontSize: 16,
              }}
            >
              {file}
            </div>
          ))}
        </div>
      )}

      {!activeCost && (
        <div style={{ margin: "12px 14px 0", height: "calc(100% - 124px)", borderRadius: 8, backgroundColor: "#161b22", padding: "12px 12px 12px 0", display: "flex", overflow: "hidden" }}>
          <div style={{ width: 30, textAlign: "right", color: "#484f58", fontSize: 13, lineHeight: "20px", fontFamily: MONO }}>
            {Array.from({ length: 120 }).map((_, i) => <div key={i}>{i + 1}</div>)}
          </div>
          <div style={{ marginLeft: 12, fontFamily: MONO, fontSize: 13, lineHeight: "20px" }}>
            {typed.map((line, i) => <div key={i} style={{ color: colorLine(line) }}>{line}</div>)}
          </div>
        </div>
      )}

      {activeCost && (
        <div style={{ padding: "26px 24px", fontFamily: FF }}>
          <div style={{ color: "#fff", fontSize: 32, fontWeight: 700, textAlign: "center", marginBottom: 18 }}>${total} / month</div>
          {COST_ROWS.map(([service, cost], i) => {
            const rowIn = interpolate(frame, [switchToCostAt + 8 + i * 8, switchToCostAt + 22 + i * 8], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div key={service} style={{ borderBottom: "1px solid #21262d", padding: "10px 0", display: "flex", justifyContent: "space-between", transform: `translateY(${interpolate(rowIn, [0, 1], [8, 0])}px)`, opacity: rowIn }}>
                <span style={{ color: "#9ca3af", fontSize: 13 }}>{service}</span>
                <span style={{ color: "#fff", fontSize: 13, fontFamily: MONO }}>{cost}</span>
              </div>
            );
          })}
          {frame >= switchToCostAt + 50 && <div style={{ marginTop: 14, display: "inline-flex", border: "1px solid rgba(34,197,94,0.3)", backgroundColor: "rgba(34,197,94,0.1)", borderRadius: 999, padding: "4px 10px", color: "#22c55e", fontSize: 12 }}>Within budget</div>}
        </div>
      )}
    </div>
  );
};
