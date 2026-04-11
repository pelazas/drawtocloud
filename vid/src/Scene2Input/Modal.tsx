import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const FF = '"DM Sans", system-ui, sans-serif';
const MONO = '"SF Mono","Fira Code","Cascadia Code",monospace';

const TYPED_TEXT = "A scalable SaaS web app with Postgres DB, Redis cache, and a global CDN for asset delivery.";
const BUDGET_TEXT = "500";

const MODAL_START = 65;
const TYPE_START = 84;
const TYPE_END = 148;
const MVP_FRAME = 132;
const UPTIME_FRAME = 148;
const SCROLL_START = 158;
const SCROLL_END = 173;
const REGION_FRAME = 178;
const BUDGET_START = 186;
const BUDGET_END = 210;

const SCROLL_AMOUNT = 155; // px to simulate scrolling

const EU_CARDS = [
  { title: "MVP / Just exploring", desc: "Perfect for testing an idea",  users: "<1K/mo" },
  { title: "Early traction",        desc: "For growing apps",             users: "1k-100k/mo" },
  { title: "Growing Business",      desc: "For scaling platforms",        users: "100k-1M/mo" },
  { title: "Enterprise Scale",      desc: "For high volume",              users: "1M+/mo" },
];

const UT_CARDS = [
  { title: "Standard",          sub: "Up to -7h downtime/month",    sla: "99.0% SLA" },
  { title: "High availability", sub: "Up to -43 min downtime/month", sla: "99.9% SLA" },
  { title: "Mission critical",  sub: "Up to -4 min downtime/month",  sla: "99.99% SLA" },
];

export const Modal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Modal entrance
  const p = spring({ frame: frame - MODAL_START, fps, config: { damping: 28, stiffness: 120 } });
  const scale = interpolate(p, [0, 1], [0.94, 1]);
  const opacity = interpolate(p, [0, 0.25], [0, 1], { extrapolateRight: "clamp" });

  // Typewriter
  const charCount = Math.floor(interpolate(frame, [TYPE_START, TYPE_END], [0, TYPED_TEXT.length], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  }));
  const blink = Math.floor(frame / 12) % 2 === 0;

  // Card springs
  const mvpP = spring({ frame: frame - MVP_FRAME, fps, config: { damping: 12, stiffness: 300 }, durationInFrames: 18 });
  const utP  = spring({ frame: frame - UPTIME_FRAME, fps, config: { damping: 12, stiffness: 300 }, durationInFrames: 18 });

  // Scroll offset
  const scrollOffset = interpolate(frame, [SCROLL_START, SCROLL_END], [0, SCROLL_AMOUNT], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  });

  // Region selection spring
  const regionP = spring({ frame: frame - REGION_FRAME, fps, config: { damping: 12, stiffness: 300 }, durationInFrames: 18 });
  const regionActive = regionP > 0.05;

  // Budget typewriter
  const budgetCharCount = Math.floor(interpolate(frame, [BUDGET_START, BUDGET_END], [0, BUDGET_TEXT.length], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  }));
  const budgetBlink = Math.floor(frame / 12) % 2 === 0;

  const cardStyle = (active: boolean, glow: number): React.CSSProperties => ({
    borderRadius: 8, padding: "10px 14px",
    border: active ? `1px solid rgba(59,130,246,${0.4 + glow * 0.6})` : "1px solid rgb(40,40,50)",
    background: active ? `rgba(14,24,45,${0.5 + glow * 0.5})` : "rgb(15,15,20)",
    boxShadow: active ? `0 0 0 1px rgba(59,130,246,${glow * 0.3}), inset 0 0 20px rgba(59,130,246,${glow * 0.05})` : "none",
  });

  if (p < 0.02) return null;

  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex",
      alignItems: "center", justifyContent: "center",
      background: `rgba(0,0,0,${interpolate(p, [0, 1], [0, 0.55])})`,
      zIndex: 50, fontFamily: FF,
    }}>
      <div style={{
        width: 860, display: "flex", flexDirection: "column",
        borderRadius: 20, border: "1px solid #374151", background: "#111827",
        padding: "24px 24px 20px",
        transform: `scale(${scale})`, opacity,
        boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.5">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/>
              <path d="M19 3l.6 1.8L21.4 5.4l-1.8.6L19 8l-.6-1.8L16.6 5.4l1.8-.6L19 3z"/>
            </svg>
            <span style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>Describe your app</span>
          </div>
          <span style={{ fontSize: 18, color: "#9ca3af", cursor: "pointer" }}>×</span>
        </div>

        {/* Scroll window — clips the scrolling content */}
        <div style={{ height: 620, overflow: "hidden", position: "relative" }}>
          {/* Scrollable content */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 16,
            transform: `translateY(-${scrollOffset}px)`,
          }}>

            {/* Textarea */}
            <div>
              <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 6 }}>What are you building?</div>
              <div style={{
                width: "100%", minHeight: 80, borderRadius: 10,
                border: "1px solid #374151", background: "#1f2937",
                padding: "10px 12px", fontSize: 14, color: "#fff",
                boxSizing: "border-box",
              }}>
                {charCount > 0 ? TYPED_TEXT.slice(0, charCount) : (
                  <span style={{ color: "#6b7280" }}>Describe your application, its purpose, and key requirements...</span>
                )}
                {charCount > 0 && charCount < TYPED_TEXT.length && (
                  <span style={{ opacity: blink ? 1 : 0, borderLeft: "2px solid #fff", marginLeft: 1 }}>&nbsp;</span>
                )}
              </div>
              {/* AI helper row */}
              <div style={{
                marginTop: 8, borderRadius: 10, border: "1px solid #374151", background: "#1f2937",
                padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span style={{ fontSize: 14, color: "#d1d5db" }}>Use AI to analyze your codebase</span>
                <span style={{ fontSize: 16, color: "#9ca3af" }}>›</span>
              </div>
            </div>

            {/* Expected users */}
            <div>
              <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 8 }}>Expected users</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {EU_CARDS.map((c, i) => {
                  const active = i === 0 && mvpP > 0.05;
                  const glow = i === 0 ? mvpP : 0;
                  return (
                    <div key={c.title} style={cardStyle(active, glow)}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>{c.title}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{c.desc}</div>
                      <div style={{ fontSize: 11, fontFamily: MONO, color: "#93c5fd", marginTop: 3 }}>Expected users: {c.users}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Uptime */}
            <div>
              <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 8 }}>Uptime</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {UT_CARDS.map((c, i) => {
                  const active = i === 0 && utP > 0.05;
                  const glow = i === 0 ? utP : 0;
                  return (
                    <div key={c.title} style={{ ...cardStyle(active, glow), display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>{c.title}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{c.sub}</div>
                      </div>
                      <span style={{ fontSize: 11, fontFamily: MONO, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.sla}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AWS Region */}
            <div>
              <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 6 }}>AWS Regions</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Recommended from your IP location: <span style={{ color: "#9ca3af" }}>us-east-1 (US East - N. Virginia)</span>
              </div>
              {/* Region card */}
              <div style={{
                borderRadius: 8, padding: "12px 16px",
                border: regionActive
                  ? `1px solid rgba(59,130,246,${0.4 + regionP * 0.6})`
                  : "1px solid rgb(40,40,50)",
                background: regionActive
                  ? `rgba(14,24,45,${0.5 + regionP * 0.5})`
                  : "rgb(15,15,20)",
                boxShadow: regionActive
                  ? `0 0 0 1px rgba(59,130,246,${regionP * 0.3})`
                  : "none",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                {/* Checkbox */}
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  border: regionActive ? "1px solid #3b82f6" : "1px solid #4b5563",
                  background: regionActive ? "#3b82f6" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {regionActive && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: 14, color: "#fff" }}>us-east-1</span>
                <span style={{ fontSize: 13, color: "#6b7280" }}>US East (N. Virginia)</span>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                {regionActive ? "1 region selected" : "0 regions selected"}
              </div>
            </div>

            {/* Monthly budget */}
            <div>
              <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 6 }}>Monthly budget (USD)</div>
              <div style={{
                display: "inline-flex", alignItems: "center",
                borderRadius: 8, border: "1px solid #374151", background: "#1f2937",
                padding: "8px 12px", fontSize: 14, color: "#fff",
                minWidth: 140,
              }}>
                {budgetCharCount > 0 ? (
                  <>
                    {BUDGET_TEXT.slice(0, budgetCharCount)}
                    {budgetCharCount < BUDGET_TEXT.length && (
                      <span style={{ opacity: budgetBlink ? 1 : 0, borderLeft: "2px solid #fff", marginLeft: 1 }}>&nbsp;</span>
                    )}
                  </>
                ) : (
                  <span style={{ color: "#6b7280" }}>e.g. 500</span>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Footer — fixed outside scroll */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 16 }}>
          <div style={{
            borderRadius: 12, border: "1px solid #374151", background: "#1f2937",
            padding: "9px 18px", fontSize: 14, fontWeight: 500, color: "#d1d5db",
          }}>Cancel</div>
          <div style={{
            borderRadius: 12,
            background: "#2563eb",
            padding: "9px 20px", fontSize: 14, fontWeight: 500, color: "#fff",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/>
            </svg>
            Generate Architecture
          </div>
        </div>
      </div>
    </div>
  );
};
