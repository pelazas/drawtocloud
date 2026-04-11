export type GenerationAgentStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export interface GenerationAgentState {
  agent: string;
  label: string;
  status: GenerationAgentStatus;
  summary: string;
  detail: string | null;
  blocked_by: string[];
  started_at: string | null;
  completed_at: string | null;
  elapsed_ms: number | null;
  progress_text: string | null;
  history: string[];
  error: string | null;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "blocked",
]);

function isGenerationAgentStatus(value: unknown): value is GenerationAgentStatus {
  return typeof value === "string" && VALID_STATUSES.has(value);
}

function normalizeAgent(raw: unknown): GenerationAgentState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.agent !== "string" || !obj.agent) return null;
  if (!isGenerationAgentStatus(obj.status)) return null;

  const history = Array.isArray(obj.history)
    ? obj.history.filter((item: unknown): item is string => typeof item === "string")
    : [];

  return {
    agent: obj.agent,
    label: typeof obj.label === "string" && obj.label ? obj.label : obj.agent,
    status: obj.status,
    summary: typeof obj.summary === "string" ? obj.summary : "",
    detail: typeof obj.detail === "string" ? obj.detail : null,
    blocked_by: Array.isArray(obj.blocked_by)
      ? obj.blocked_by.filter((item: unknown): item is string => typeof item === "string")
      : [],
    started_at: typeof obj.started_at === "string" ? obj.started_at : null,
    completed_at: typeof obj.completed_at === "string" ? obj.completed_at : null,
    elapsed_ms: typeof obj.elapsed_ms === "number" ? obj.elapsed_ms : null,
    progress_text: typeof obj.progress_text === "string" ? obj.progress_text : null,
    history,
    error: typeof obj.error === "string" ? obj.error : null,
  };
}

export function parseGenerationAgentUpdate(msg: unknown): GenerationAgentState[] | null {
  if (typeof msg !== "object" || msg === null) return null;
  const obj = msg as Record<string, unknown>;
  if (obj.type !== "generation_agent_update") return null;
  if (!Array.isArray(obj.agents)) return null;

  const agents: GenerationAgentState[] = [];
  for (const item of obj.agents) {
    const normalized = normalizeAgent(item);
    if (normalized) agents.push(normalized);
  }
  return agents.length > 0 ? agents : null;
}

export function parseGenerationAgentsFromSnapshot(
  msg: unknown,
): GenerationAgentState[] | null {
  if (typeof msg !== "object" || msg === null) return null;
  const obj = msg as Record<string, unknown>;
  if (obj.type !== "generation_snapshot") return null;
  if (!Array.isArray(obj.generation_agents)) return null;

  const agents: GenerationAgentState[] = [];
  for (const item of obj.generation_agents) {
    const normalized = normalizeAgent(item);
    if (normalized) agents.push(normalized);
  }
  return agents.length > 0 ? agents : null;
}
