import React from "react";
import { interpolate } from "remotion";
import { AI_FULL_PROMPT, FF, MONO } from "./constants";

const pixels: Array<[number, number]> = [
  [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
  [0, 1], [1, 1], [5, 1], [6, 1],
  [0, 2], [6, 2], [0, 3], [6, 3],
  [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4],
  [1, 5], [2, 5], [4, 5], [5, 5], [2, 6], [3, 6], [4, 6],
];

interface Props {
  localFrame: number;
  startupPasted: boolean;
  responseDone: boolean;
  postCopied: boolean;
  responseText: string;
  showResponseCursor: boolean;
}

export const WorkflowIDEStartup: React.FC<Props> = ({
  localFrame,
  startupPasted,
  responseDone,
  postCopied,
  responseText,
  showResponseCursor,
}) => {
  const typedLen = Math.floor(interpolate(localFrame, [30, 60], [0, 6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const typed = "claude".slice(0, typedLen);
  const inputSelected = localFrame >= 28 && localFrame < 70;
  const showCaret = localFrame % 24 < 10;
  const showClaudeBlock = localFrame >= 70;
  const claudeInputFocused = localFrame >= 70;
  const thinkingStart = 125; // 30 frames after paste at local 95
  const thinkingEnd = 205; // keep 80-frame thinking duration
  const showThinking = localFrame >= thinkingStart && localFrame < thinkingEnd;
  const showPasteCaret = startupPasted && !showThinking;
  const promptHighlighted = localFrame >= thinkingStart;
  const thinkingStep = Math.max(0, Math.floor((localFrame - thinkingStart) / 15));
  const dots = ".".repeat((thinkingStep % 3) + 1);
  const iconRot = (localFrame - thinkingStart) * 8;
  const responseViewportH = 150;
  const estimatedLines = responseText.split("\n").reduce((acc, line) => {
    return acc + Math.max(1, Math.ceil(line.length / 95));
  }, 0);
  const contentHeight = estimatedLines * 19;
  const terminalViewportH = 310;
  const scrollOffset = Math.max(0, contentHeight - responseViewportH);

  return (
  <div style={{ padding: "12px 18px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", fontFamily: MONO }}>
    <div style={{ fontSize: 13, marginBottom: 14 }}>
      <span style={{ color: "#9ca3af" }}>o pelazas@mac drawtocloud % </span>
      <span
        style={{
          color: "#d4d4d4",
          backgroundColor: inputSelected ? "rgba(59,130,246,0.22)" : "transparent",
          borderRadius: 3,
          padding: inputSelected ? "0 2px" : 0,
        }}
      >
        {typed}
      </span>
      {inputSelected && showCaret && (
        <span style={{ color: "#d4d4d4" }}>|</span>
      )}
    </div>

    {showClaudeBlock && (
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <div style={{ transform: `translateY(${-scrollOffset}px)` }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 8 }}>
            <svg width={42} height={42} viewBox="0 0 42 42">
              {pixels.map(([x, y], i) => (
                <rect key={i} x={x * 6} y={y * 6} width={6} height={6} fill="#d97706" />
              ))}
            </svg>
            <div style={{ fontFamily: FF }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#d97706" }}>Claude Code</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Sonnet 4.6 - Claude Pro</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>~/Desktop/drawtocloud</div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid #3c3c3c", marginBottom: 10 }} />
          <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 8 }}>
            {!startupPasted ? (
              <>
                <span>&gt; </span>
                {claudeInputFocused && showCaret && (
                  <span style={{ color: "#d4d4d4" }}>|</span>
                )}
              </>
            ) : (
              <pre
                style={{
                  margin: 0,
                  color: "#d4d4d4",
                  whiteSpace: "pre-wrap",
                  fontFamily: MONO,
                  fontSize: 12,
                  lineHeight: 1.45,
                  backgroundColor: promptHighlighted ? "rgba(229,231,235,0.16)" : "transparent",
                  border: promptHighlighted ? "1px solid rgba(229,231,235,0.25)" : "none",
                  borderRadius: promptHighlighted ? 6 : 0,
                  padding: promptHighlighted ? "8px 10px" : 0,
                }}
              >
                {`> ${AI_FULL_PROMPT}`}{showPasteCaret && showCaret ? "|" : ""}
              </pre>
            )}
          </div>
          <div style={{ borderTop: "1px solid #3c3c3c", marginBottom: 8 }} />

          {showThinking && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#d97706", fontFamily: FF, marginBottom: 8 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" style={{ transform: `rotate(${iconRot}deg)` }}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <rect
                    key={i}
                    x="11"
                    y="1"
                    width="2"
                    height="6"
                    rx="1"
                    fill="#d47a57"
                    transform={`rotate(${i * 30} 12 12)`}
                  />
                ))}
              </svg>
              <span>thinking{dots}</span>
            </div>
          )}

          <div
            style={{
              color: "#d4d4d4",
              fontSize: 12,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              minHeight: responseViewportH,
              marginBottom: 8,
            }}
          >
            {showThinking ? "" : responseText}
            {!showThinking && showResponseCursor ? "|" : ""}
          </div>
          {responseDone && (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  backgroundColor: "rgba(55,65,81,0.8)",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 4,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth={2}>
                  {postCopied ? (
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <>
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </>
                  )}
                </svg>
              </div>
              <div
                style={{
                  marginBottom: 8,
                  color: "#9ca3af",
                  fontFamily: FF,
                  fontSize: 12,
                }}
              >
                <span>✻ Brewed for 47s</span>
              </div>
              <div style={{ borderTop: "1px solid #3c3c3c", marginBottom: 8 }} />
              <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 8 }}>&gt;</div>
              <div style={{ borderTop: "1px solid #3c3c3c" }} />
            </div>
          )}
        </div>
        <div style={{ height: Math.max(0, terminalViewportH - responseViewportH) }} />
        <div style={{ position: "absolute", left: 18, right: 18, bottom: 6, display: "flex", justifyContent: "space-between", fontFamily: FF, fontSize: 11, color: "#6b7280" }}>
          <span>? for shortcuts</span>
          <span>o medium - /effort</span>
        </div>
      </div>
    )}
  </div>
  );
};
