import React from "react";

const FF = '"DM Sans", system-ui, sans-serif';
const MONO = '"SF Mono","Fira Code","Cascadia Code",monospace';

const TABS = [
  { label: "EC2 Dashboard", active: false },
  { label: "RDS Instances", active: false },
  { label: "VPC Config", active: true },
  { label: "IAM Roles", active: false },
  { label: "CloudWatch", active: false },
];

export const TITLE_H = 42;
export const TAB_H = 38;
export const URL_H = 34;
export const CHROME_H = TITLE_H + TAB_H + URL_H;

interface Props {
  width: number;
  height: number;
  children: React.ReactNode;
}

export const BrowserChrome: React.FC<Props> = ({ width, height, children }) => {
  const contentH = height - CHROME_H;

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.70), 0 0 0 1px rgba(255,255,255,0.06)",
      }}
    >
      {/* Title bar */}
      <div style={{ height: TITLE_H, background: "#1e2030", display: "flex", alignItems: "center", paddingLeft: 16, gap: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {(["#ff5f57", "#febc2e", "#28c840"] as const).map((c, i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
        ))}
        <div style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#6b7280", fontFamily: FF, marginRight: 52 }}>
          AWS Management Console — Chrome
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ height: TAB_H, background: "#252840", display: "flex", alignItems: "flex-end", paddingLeft: 8, gap: 2 }}>
        {TABS.map((tab, i) => (
          <div
            key={i}
            style={{
              height: 30,
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              background: tab.active ? "#f8fafc" : "#2a2d45",
              borderRadius: "6px 6px 0 0",
              fontSize: 11,
              fontFamily: FF,
              color: tab.active ? "#1e293b" : "#64748b",
              fontWeight: tab.active ? 600 : 400,
              whiteSpace: "nowrap",
              minWidth: 110,
            }}
          >
            {tab.label}
          </div>
        ))}
      </div>

      {/* URL bar */}
      <div style={{ height: URL_H, background: "#1a1b2e", display: "flex", alignItems: "center", padding: "0 12px", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", gap: 6, fontSize: 12, color: "#374151", fontFamily: "system-ui" }}>
          <span>‹</span><span>›</span>
        </div>
        <div style={{ flex: 1, height: 22, background: "#0d0f1f", borderRadius: 4, display: "flex", alignItems: "center", paddingLeft: 10, gap: 6 }}>
          <span style={{ fontSize: 10, color: "#22c55e" }}>🔒</span>
          <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: MONO }}>
            console.aws.amazon.com/vpc/home?region=us-east-1#vpcs:
          </span>
        </div>
      </div>

      {/* Content area */}
      <div style={{ width, height: contentH, position: "relative", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
};
