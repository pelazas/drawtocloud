import React from "react";

const FF = '"DM Sans", system-ui, sans-serif';

const MESSAGES = [
  { role: "user", text: "Design a scalable web app for my SaaS startup" },
  { role: "assistant", text: "I'll set up a production-ready architecture: ECS Fargate with auto-scaling, RDS PostgreSQL, ElastiCache Redis, and CloudFront CDN. Building it now..." },
];

const STARTERS = [
  "Where is the highest monthly cost?",
  "How can I make this cheaper?",
  "What are the security risks?",
];

export const ChatPanel: React.FC = () => (
  <div style={{
    width: 320, height: "100%", display: "flex", flexDirection: "column",
    background: "#0b1020", borderRight: "1px solid #1b2339", fontFamily: FF,
  }}>
    {/* Messages */}
    <div style={{ flex: 1, overflowY: "hidden", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {MESSAGES.map((m, i) => (
        <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
          <div style={{
            maxWidth: "85%", borderRadius: 12, padding: "8px 12px", fontSize: 13,
            background: m.role === "user" ? "#2563eb" : "#1f2937",
            color: m.role === "user" ? "#fff" : "#e5e7eb",
          }}>
            {m.text}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {STARTERS.map((s) => (
          <div key={s} style={{
            border: "1px solid #374151", background: "rgba(31,41,55,0.7)",
            borderRadius: 20, padding: "6px 12px", fontSize: 12, color: "#e5e7eb",
          }}>{s}</div>
        ))}
      </div>
    </div>

    {/* Selected node chips */}
    <div style={{ padding: "6px 14px", display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[{ label: "ALB", color: "#f97316" }, { label: "ECS", color: "#f97316" }, { label: "RDS", color: "#22c55e" }].map((n) => (
        <div key={n.label} style={{
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#e5e7eb",
          display: "flex", alignItems: "center", gap: 4,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: n.color }} />
          {n.label}
        </div>
      ))}
    </div>

    {/* Input */}
    <div style={{ borderTop: "1px solid #374151", padding: "10px 12px", display: "flex", gap: 8, alignItems: "flex-end" }}>
      <div style={{
        flex: 1, borderRadius: 10, border: "1px solid #4b5563", background: "#1f2937",
        padding: "8px 12px", fontSize: 13, color: "#6b7280",
      }}>
        e.g. What database am I using?
      </div>
      <div style={{
        width: 34, height: 34, borderRadius: 8, background: "#2563eb",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
          <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </div>
    </div>
  </div>
);
