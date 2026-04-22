export type AgentLogEntry = {
  id: number;
  agent: "requirements" | "architect" | "coder" | "description";
  message: string;
  elapsed: number;
};

export type DebugEvent = {
  id: number;
  ts: number;
  level: "info" | "warning" | "error";
  source: "ws" | "pipeline" | "local";
  stage: string | null;
  message: string;
  traceId: string | null;
  details?: Record<string, unknown>;
};

export type TerraformProgress = {
  status: "idle" | "planning" | "requesting" | "generating" | "finalizing" | "completed" | "failed";
  activity: string | null;
  emittedCount: number;
  expectedMinFiles: number;
  currentFile: string | null;
  lastUpdateAt: number | null;
};

export type CanvasPipelineOptions = {
  liveSession?: boolean;
  readOnly?: boolean;
};
