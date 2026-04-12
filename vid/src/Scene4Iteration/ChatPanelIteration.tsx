import React from "react";
import {
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const FF = '"DM Sans", system-ui, sans-serif';

const USER_MESSAGE = "Make this architecture serverless";
const PLAN_LINES = [
  { text: "Here's the plan:", header: true },
  { text: "• Replace ALB → API Gateway" },
  { text: "• Replace EC2 → Lambda functions" },
  { text: "• Replace RDS → DynamoDB" },
  { text: "• Keep S3 for static assets" },
  { text: "Estimated cost reduction: ~40%", cost: true },
];

interface Props {
  chatTranslateX: number;
  typewriteStart: number;
  typewriteEnd: number;
  sendClickAt: number;
  loadingStart: number;
  loadingEnd: number;
  planStart: number;
  implementBtnAt: number;
  clickBtnAt: number;
}

export const ChatPanelIteration: React.FC<Props> = ({
  chatTranslateX,
  typewriteStart,
  typewriteEnd,
  sendClickAt,
  loadingStart,
  loadingEnd,
  planStart,
  implementBtnAt,
  clickBtnAt,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── Typewriter ──────────────────────────────────────────────────
  const typedLength = Math.round(
    interpolate(
      frame,
      [typewriteStart, typewriteEnd],
      [0, USER_MESSAGE.length],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
  );
  const typedText = USER_MESSAGE.substring(0, typedLength);
  const isTyping = frame >= typewriteStart && frame < typewriteEnd;
  const typingDone = frame >= typewriteEnd;

  // Blinking cursor in input field (only while typing)
  const inputCursorVisible =
    isTyping && Math.floor(frame / 6) % 2 === 0;

  // After typing is done, input shows the full text without blinking cursor
  const displayText = typingDone ? USER_MESSAGE : typedText;

  // ── Send button press visual ───────────────────────────────────
  const sendPressed = frame >= sendClickAt && frame < sendClickAt + 6;

  // ── Message bubble appears after send ───────────────────────────
  const msgBubbleProgress = spring({
    frame: frame - sendClickAt - 3,
    fps,
    config: { damping: 12 },
  });
  const msgBubbleOpacity = msgBubbleProgress;
  const msgBubbleTy = interpolate(msgBubbleProgress, [0, 1], [8, 0]);

  // ── Loading indicator ──────────────────────────────────────────
  const loadingOpacity = interpolate(
    frame,
    [loadingStart, loadingStart + 4, loadingEnd - 4, loadingEnd],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const dot1 = Math.sin(frame * 0.2) * 0.5 + 0.5;
  const dot2 = Math.sin(frame * 0.2 - 1) * 0.5 + 0.5;
  const dot3 = Math.sin(frame * 0.2 - 2) * 0.5 + 0.5;

  // ── AI Plan lines ──────────────────────────────────────────────
  const planContainerOpacity = interpolate(
    frame,
    [planStart, planStart + 4],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // ── Implement button ───────────────────────────────────────────
  const implBtnProgress = spring({
    frame: frame - implementBtnAt,
    fps,
    config: { damping: 12 },
  });
  const implBtnOpacity = implBtnProgress;
  const implBtnScale = interpolate(implBtnProgress, [0, 1], [0.95, 1]);
  const isBtnClicked = frame >= clickBtnAt;
  const implBtnBg = isBtnClicked ? "#1d4ed8" : "#2563eb";
  const implBtnTransform = isBtnClicked
    ? 0.97
    : implBtnScale;

  // ── Pulse animation for button before click ────────────────────
  const pulseScale =
    frame >= implementBtnAt && !isBtnClicked
      ? 1 + Math.sin((frame - implementBtnAt) * 0.12) * 0.01
      : 1;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 360,
        height: "100%",
        transform: `translateX(${chatTranslateX}px)`,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        background: "#0b1020",
        borderRight: "1px solid #1b2339",
        fontFamily: FF,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 18px",
          borderBottom: "1px solid #1b2339",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: "#3b82f6",
          }}
        />
        <span style={{ color: "#e5e7eb", fontSize: 15, fontWeight: 600 }}>
          DrawToCloud AI
        </span>
      </div>

      {/* Messages area — includes plan response + implement button */}
      <div
        style={{
          flex: 1,
          overflowY: "hidden",
          padding: "14px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Previous conversation */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              maxWidth: "90%",
              borderRadius: 12,
              padding: "8px 12px",
              fontSize: 12.5,
              background: "#2563eb",
              color: "#fff",
              lineHeight: 1.4,
            }}
          >
            Design a scalable web app for my SaaS startup
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <div
            style={{
              maxWidth: "90%",
              borderRadius: 12,
              padding: "8px 12px",
              fontSize: 12.5,
              background: "#1f2937",
              color: "#9ca3af",
              lineHeight: 1.4,
            }}
          >
            I'll set up a production-ready architecture with load-balanced ECS,
            RDS PostgreSQL, Redis cache, and CloudFront. Building it now...
          </div>
        </div>

        {/* New user message bubble (appears after send click) */}
        {msgBubbleOpacity > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              opacity: msgBubbleOpacity,
              transform: `translateY(${msgBubbleTy}px)`,
            }}
          >
            <div
              style={{
                maxWidth: "90%",
                borderRadius: 12,
                padding: "8px 12px",
                fontSize: 12.5,
                background: "#2563eb",
                color: "#fff",
                lineHeight: 1.4,
                fontWeight: 500,
              }}
            >
              {USER_MESSAGE}
            </div>
          </div>
        )}

        {/* Loading indicator (pulsing dots) */}
        {loadingOpacity > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-start",
              opacity: loadingOpacity,
            }}
          >
            <div
              style={{
                borderRadius: 12,
                padding: "10px 16px",
                background: "#1f2937",
                display: "flex",
                gap: 5,
                alignItems: "center",
              }}
            >
              {[dot1, dot2, dot3].map((d, i) => (
                <div
                  key={i}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    backgroundColor: "#6b7280",
                    opacity: d,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* AI Plan response */}
        {planContainerOpacity > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-start",
              opacity: planContainerOpacity,
            }}
          >
            <div
              style={{
                maxWidth: "95%",
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 12.5,
                background: "#1f2937",
                color: "#d1d5db",
                lineHeight: 1.5,
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              {PLAN_LINES.map((line, i) => {
                const lineAppearAt =
                  line.header
                    ? planStart
                    : planStart + 3 + i * 3;
                const lineOpacity = interpolate(
                  frame,
                  [lineAppearAt, lineAppearAt + 3],
                  [0, 1],
                  {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }
                );
                return (
                  <div
                    key={i}
                    style={{
                      opacity: lineOpacity,
                      color: line.cost
                        ? "#22c55e"
                        : line.header
                          ? "#e5e7eb"
                          : "#c4c9d4",
                      fontWeight:
                        line.cost || line.header ? 600 : 400,
                    }}
                  >
                    {line.text}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Implement button — below the plan message, inside messages area */}
        {implBtnOpacity > 0 && (
          <div
            style={{
              opacity: implBtnOpacity,
              paddingTop: 4,
            }}
          >
            <div
              style={{
                maxWidth: "95%",
                borderRadius: 10,
                border: "none",
                background: implBtnBg,
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: FF,
                padding: "10px 0",
                textAlign: "center",
                cursor: "pointer",
                transform: `scale(${implBtnTransform * pulseScale})`,
                transformOrigin: "center center",
                letterSpacing: "0.02em",
                boxShadow: "0 2px 16px rgba(37,99,235,0.35)",
              }}
            >
              {isBtnClicked ? "Applying..." : "Implement"}
            </div>
          </div>
        )}
      </div>

      {/* Input field — ALWAYS visible at the bottom */}
      <div
        style={{
          borderTop: "1px solid #1b2339",
          padding: "10px 12px",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <div
          style={{
            flex: 1,
            borderRadius: 10,
            border: isTyping ? "1px solid #3b82f6" : "1px solid #4b5563",
            background: "#1f2937",
            padding: "8px 12px",
            fontSize: 13,
            color: "#e5e7eb",
            minHeight: 36,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {displayText}
          {inputCursorVisible && (
            <span
              style={{
                display: "inline-block",
                width: 1.5,
                height: 15,
                backgroundColor: "#9ca3af",
                marginLeft: 1,
                verticalAlign: "text-bottom",
              }}
            />
          )}
        </div>
        {/* Send button */}
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background:
              typingDone || isTyping ? "#2563eb" : "#374151",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transform: sendPressed ? "scale(0.9)" : "scale(1)",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </div>
      </div>
    </div>
  );
};
