import React from "react";

export function deriveNodeType(id: string): string {
  return id
    .replace(/_(az1|az2|primary|secondary|[12])$/i, "")
    .toLowerCase();
}

const icons: Record<string, (color: string) => React.ReactElement> = {
  vpc: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <rect x="3" y="3" width="26" height="26" rx="3" />
      <rect x="8" y="8" width="7" height="7" rx="1" />
      <rect x="17" y="8" width="7" height="7" rx="1" />
      <rect x="8" y="17" width="7" height="7" rx="1" />
      <rect x="17" y="17" width="7" height="7" rx="1" />
    </svg>
  ),
  alb: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <rect x="3" y="12" width="26" height="8" rx="2" />
      <line x1="8" y1="16" x2="8" y2="8" /><line x1="16" y1="16" x2="16" y2="8" /><line x1="24" y1="16" x2="24" y2="8" />
      <line x1="8" y1="20" x2="8" y2="26" /><line x1="16" y1="20" x2="16" y2="26" /><line x1="24" y1="20" x2="24" y2="26" />
    </svg>
  ),
  ecs: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <rect x="4" y="4" width="11" height="11" rx="1" />
      <rect x="17" y="4" width="11" height="11" rx="1" />
      <rect x="4" y="17" width="11" height="11" rx="1" />
      <rect x="17" y="17" width="11" height="11" rx="1" />
    </svg>
  ),
  ec2: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <rect x="5" y="5" width="22" height="22" rx="2" />
      <rect x="10" y="10" width="12" height="12" rx="1" />
    </svg>
  ),
  lambda: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <polygon points="16,4 28,28 4,28" />
      <line x1="10" y1="28" x2="22" y2="12" />
    </svg>
  ),
  rds: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <ellipse cx="16" cy="9" rx="11" ry="4" />
      <line x1="5" y1="9" x2="5" y2="23" /><line x1="27" y1="9" x2="27" y2="23" />
      <ellipse cx="16" cy="23" rx="11" ry="4" />
      <ellipse cx="16" cy="16" rx="11" ry="4" />
    </svg>
  ),
  dynamodb: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <ellipse cx="16" cy="8" rx="11" ry="3.5" />
      <line x1="5" y1="8" x2="5" y2="24" /><line x1="27" y1="8" x2="27" y2="24" />
      <ellipse cx="16" cy="24" rx="11" ry="3.5" />
    </svg>
  ),
  elasticache: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <circle cx="16" cy="16" r="12" />
      <line x1="16" y1="4" x2="16" y2="28" />
      <line x1="4" y1="16" x2="28" y2="16" />
    </svg>
  ),
  s3: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <path d="M6 10 L16 6 L26 10 L26 22 L16 26 L6 22 Z" />
      <line x1="6" y1="10" x2="26" y2="10" />
    </svg>
  ),
  efs: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <rect x="4" y="8" width="24" height="16" rx="2" />
      <line x1="4" y1="13" x2="28" y2="13" />
      <line x1="4" y1="19" x2="28" y2="19" />
      <circle cx="9" cy="11" r="1" fill={c} />
      <circle cx="9" cy="16" r="1" fill={c} />
    </svg>
  ),
  iam: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <circle cx="16" cy="11" r="5" />
      <path d="M6 26 C6 20 26 20 26 26" />
      <circle cx="16" cy="16" r="12" />
    </svg>
  ),
  waf: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <path d="M16 3 L28 8 L28 18 C28 24 22 29 16 31 C10 29 4 24 4 18 L4 8 Z" />
      <polyline points="11,16 15,20 22,12" />
    </svg>
  ),
  cloudwatch: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <circle cx="16" cy="16" r="12" />
      <polyline points="8,22 13,14 17,18 22,10" />
    </svg>
  ),
  sns: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <circle cx="16" cy="16" r="4" />
      <path d="M10 22 Q4 28 6 30 Q8 32 14 26" />
      <path d="M12 10 Q8 4 5 5 Q3 7 8 12" />
      <path d="M22 12 Q28 6 27 4 Q25 2 20 8" />
      <path d="M20 22 Q24 28 27 27 Q29 25 24 20" />
    </svg>
  ),
  sqs: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <rect x="4" y="10" width="24" height="12" rx="2" />
      <line x1="9" y1="14" x2="9" y2="18" />
      <line x1="14" y1="14" x2="14" y2="18" />
      <line x1="19" y1="14" x2="19" y2="18" />
      <line x1="24" y1="14" x2="24" y2="18" />
    </svg>
  ),
  apigateway: (c) => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
      <rect x="4" y="4" width="24" height="24" rx="2" />
      <line x1="4" y1="12" x2="28" y2="12" />
      <line x1="12" y1="12" x2="12" y2="28" />
      <line x1="8" y1="18" x2="10" y2="18" />
      <line x1="8" y1="22" x2="10" y2="22" />
    </svg>
  ),
};

const fallback = (c: string): React.ReactElement => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.5">
    <path d="M8 20 Q4 20 4 16 Q4 10 10 10 Q11 5 16 5 Q22 5 22 10 Q28 10 28 16 Q28 20 24 20 Z" />
  </svg>
);

export function iconForNode(nodeType: string, color: string): React.ReactElement {
  const fn = icons[nodeType.toLowerCase()];
  return fn ? fn(color) : fallback(color);
}
