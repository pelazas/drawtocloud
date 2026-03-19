import React from "react";
import { interpolate } from "remotion";
import { AI_PROMPT_PREVIEW, FF, MONO } from "./constants";

const inputBase: React.CSSProperties = {
  width: "100%",
  backgroundColor: "rgb(31,41,55)",
  border: "1px solid rgb(55,65,81)",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#fff",
  fontSize: 14,
  fontFamily: FF,
  boxSizing: "border-box",
};

interface Props {
  description: string;
  aiHelperProgress: number;
  copyConfirmed: boolean;
}

export const WorkflowFormHeader: React.FC<Props> = ({
  description,
  aiHelperProgress,
  copyConfirmed,
}) => {
  const panelHeight = interpolate(aiHelperProgress, [0, 1], [0, 210]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ textAlign: "center", fontFamily: FF }}>
        <h1 style={{ margin: 0, color: "#fff", fontSize: 24, fontWeight: 600 }}>New Architecture</h1>
        <p style={{ margin: "4px 0 0", color: "#9ca3af", fontSize: 14 }}>4 / 5 remaining</p>
      </div>

      <div>
        <div style={{ color: "#9ca3af", fontSize: 14, marginBottom: 6, fontFamily: FF }}>Project name *</div>
        <input style={inputBase} value="WikiGlobe" readOnly />
      </div>

      <div>
        <div style={{ color: "#9ca3af", fontSize: 14, marginBottom: 6, fontFamily: FF }}>
          Describe your app <span style={{ color: "#6b7280" }}>(optional)</span>
        </div>
        <textarea
          rows={3}
          value={description}
          placeholder="e.g. A SaaS analytics..."
          readOnly
          style={{
            ...inputBase,
            minHeight: 150,
            color: description ? "#f3f4f6" : "#6b7280",
            fontFamily: description ? MONO : FF,
            fontSize: description ? 12 : 14,
            lineHeight: 1.6,
            resize: "none",
          }}
        />

        <div style={{ marginTop: 8, border: "1px solid rgb(55,65,81)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ height: 40, backgroundColor: "rgb(17,24,39)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", color: "#9ca3af", fontFamily: FF, fontSize: 14 }}>
            <span>Use AI to analyze your codebase</span>
            <span style={{ fontSize: 16 }}>{">"}</span>
          </div>
          <div style={{ maxHeight: panelHeight, opacity: aiHelperProgress, overflow: "hidden", backgroundColor: "rgba(17,24,39,0.5)" }}>
            <div style={{ padding: 16 }}>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "#6b7280", fontFamily: FF }}>
                Copy this prompt, paste it into Claude Code or any AI with codebase access, then paste the response in the description above.
              </p>
              <div style={{ position: "relative" }}>
                <pre style={{ margin: 0, maxHeight: 112, overflow: "hidden", backgroundColor: "rgb(31,41,55)", borderRadius: 8, padding: 12, color: "#d1d5db", fontSize: 12, fontFamily: MONO, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{AI_PROMPT_PREVIEW}</pre>
                <div style={{ position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 6, backgroundColor: "rgb(55,65,81)", display: "grid", placeItems: "center" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={copyConfirmed ? "#22c55e" : "#d1d5db"} strokeWidth={2}>
                    {copyConfirmed ? (
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    ) : (
                      <>
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </>
                    )}
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
