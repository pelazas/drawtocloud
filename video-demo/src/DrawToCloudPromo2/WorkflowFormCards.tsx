import React from "react";
import { FF } from "./constants";

const users = [
  ["MVP / Just exploring", "Perfect for testing an idea...", "<1K/mo"],
  ["Early Traction", "For growing apps...", "1K-100K/mo"],
  ["Growing Business", "For scaling platforms...", "100K-1M/mo"],
  ["Enterprise Scale", "For high-volume...", "1M+/mo"],
] as const;

const uptimes = [
  ["Standard", "Up to ~7h downtime/month", "99.0% SLA", false],
  ["High Availability", "Up to ~43min downtime/month", "99.9% SLA", true],
  ["Mission Critical", "Up to ~4min downtime/month", "99.99% SLA", false],
] as const;

const cardStyle = (selected: boolean): React.CSSProperties => ({
  padding: "14px 18px",
  borderRadius: 10,
  border: selected ? "1px solid #3b82f6" : "1px solid rgb(40,40,50)",
  backgroundColor: selected ? "rgb(14,24,45)" : "rgb(15,15,20)",
  boxShadow: selected ? "0 0 0 1px rgba(59,130,246,0.3), inset 0 0 20px rgba(59,130,246,0.05)" : "none",
});

interface Props {
  selectedUsers: string;
  selectedUptime: string;
  budget: string;
  generateScale: number;
  isGenerating: boolean;
  spinAngle: number;
}

export const WorkflowFormCards: React.FC<Props> = ({
  selectedUsers,
  selectedUptime,
  budget,
  generateScale,
  isGenerating,
  spinAngle,
}) => (
  <div style={{ fontFamily: FF, display: "flex", flexDirection: "column", gap: 24 }}>
    <div>
      <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Expected Users</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {users.map(([label, desc, value]) => (
          <div key={label} style={cardStyle(selectedUsers === label)}>
            <div style={{ color: "#f9fafb", fontSize: 14, fontWeight: 500 }}>{label}</div>
            <div style={{ color: "#6b7280", fontSize: 11, marginTop: 3 }}>{desc}</div>
            <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 5 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>

    <div>
      <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Uptime</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {uptimes.map(([label, subtitle, value, recommended]) => (
          <div key={label} style={cardStyle(selectedUptime === label)}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ color: "#f9fafb", fontSize: 14, fontWeight: 500 }}>{label}</div>
              {recommended && <div style={{ backgroundColor: "rgba(59,130,246,0.12)", color: "#60a5fa", borderRadius: 999, fontSize: 10, padding: "2px 8px" }}>Recommended</div>}
            </div>
            <div style={{ color: "#6b7280", fontSize: 11, marginTop: 3 }}>{subtitle}</div>
            <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 5 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>

    <div>
      <div style={{ color: "#9ca3af", fontSize: 14, marginBottom: 6 }}>Monthly Budget (optional)</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "#6b7280", fontSize: 14 }}>$</span>
        <input value={budget} readOnly style={{ flex: 1, padding: "14px 18px", borderRadius: 10, border: "1px solid rgb(40,40,50)", backgroundColor: "rgb(15,15,20)", color: "#fff", fontSize: 16, fontFamily: FF }} />
        <span style={{ color: "#6b7280", fontSize: 14 }}>/ month</span>
      </div>
      <div style={{ color: "#4b5563", fontSize: 12, marginTop: 6 }}>Set a target to help the AI optimize for cost.</div>
    </div>

    <div style={{ transform: `scale(${generateScale})`, transformOrigin: "center" }}>
      <div style={{ borderRadius: 12, background: "linear-gradient(to right, #2563eb, #4f46e5)", color: "#fff", boxShadow: "0 10px 24px rgba(30,64,175,0.35)", fontSize: 18, fontWeight: 600, textAlign: "center", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
        {isGenerating && <div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.25)", borderTopColor: "#fff", borderRadius: "50%", transform: `rotate(${spinAngle}deg)` }} />}
        {isGenerating ? "Generating..." : "Generate Architecture"}
      </div>
    </div>
  </div>
);
