import React from "react";

const FF = '"DM Sans", system-ui, sans-serif';
const MONO = '"SF Mono","Fira Code","Cascadia Code",monospace';

const TEMPLATES = [
  {
    title: "ECS + RDS",
    description: "Scale-ready web app with ECS Fargate, Application Load Balancer, and managed RDS PostgreSQL database.",
    icon: "workflow",
  },
  {
    title: "Lambda + API Gateway",
    description: "Event-driven serverless architecture with Lambda, API Gateway, and DynamoDB for low-latency APIs.",
    icon: "workflow",
  },
  {
    title: "LLM Agent Pipeline",
    description: "Multi-agent AI backend with vector store, embedding pipeline, and scalable inference endpoints.",
    icon: "bot",
  },
  {
    title: "Secure Banking API",
    description: "PCI-DSS compliant fintech backend with WAF, KMS encryption, audit logging, and full VPC isolation.",
    icon: "shield",
  },
];

const WorkflowIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
    <rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/>
    <rect x="9" y="15" width="6" height="6" rx="1"/>
    <path d="M6 9v3a3 3 0 003 3h6a3 3 0 003-3V9"/>
    <line x1="12" y1="12" x2="12" y2="15"/>
  </svg>
);

const BotIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
    <rect x="3" y="11" width="18" height="10" rx="2"/>
    <circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/>
    <line x1="8" y1="16" x2="8" y2="16" strokeWidth="3" strokeLinecap="round"/>
    <line x1="12" y1="16" x2="12" y2="16" strokeWidth="3" strokeLinecap="round"/>
    <line x1="16" y1="16" x2="16" y2="16" strokeWidth="3" strokeLinecap="round"/>
  </svg>
);

const ShieldIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <polyline points="9 12 11 14 15 10"/>
  </svg>
);

function TemplateIcon({ type }: { type: string }) {
  if (type === "bot") return <BotIcon />;
  if (type === "shield") return <ShieldIcon />;
  return <WorkflowIcon />;
}

const TemplateCard: React.FC<typeof TEMPLATES[number]> = ({ title, description, icon }) => (
  <div style={{
    height: 196, borderRadius: 24, border: "1px solid #21273a", background: "rgba(21,26,44,0.75)",
    padding: "16px 20px", display: "flex", flexDirection: "column", flexShrink: 0,
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <TemplateIcon type={icon} />
      <span style={{ fontSize: 18, fontWeight: 600, color: "#f1f5f9", letterSpacing: "0.01em", lineHeight: 1.2 }}>{title}</span>
    </div>
    <p style={{
      marginTop: 12, fontSize: 13, lineHeight: 1.5, color: "#7f8aa7",
      height: 72, overflow: "hidden",
    }}>{description}</p>
    <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "#3b82f6", fontFamily: MONO }}>Load</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5">
        <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
      </svg>
    </div>
  </div>
);

export const TemplatesPanel: React.FC = () => (
  <div style={{
    width: 320, height: "100%", display: "flex", flexDirection: "column",
    background: "#0b1020", borderLeft: "1px solid #1b2339", fontFamily: FF,
  }}>
    {/* Header */}
    <div style={{
      padding: "14px 16px", borderBottom: "1px solid #1b2339",
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <WorkflowIcon />
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.02em", color: "#e4ebff" }}>Templates</span>
      </div>
      <span style={{ fontSize: 16, color: "#6b7280", cursor: "pointer" }}>×</span>
    </div>

    {/* Template list */}
    <div style={{
      flex: 1, overflowY: "hidden", padding: "16px 16px",
      display: "flex", flexDirection: "column", gap: 14,
      background: "linear-gradient(180deg, #0b1020 0%, #0a0f1c 100%)",
    }}>
      {TEMPLATES.map((t) => <TemplateCard key={t.title} {...t} />)}
    </div>
  </div>
);
