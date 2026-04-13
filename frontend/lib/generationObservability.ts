export type GenerationAgentStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export interface GenerationAgentEvent {
  agent: string;
  status: string;
  event_type: string;
  message: string;
  history: boolean;
  started_at: string | null;
  completed_at: string | null;
  ts: string;
}

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

export function parseGenerationAgentUpdate(
  msg: unknown,
): GenerationAgentState[] | null {
  if (typeof msg !== "object" || msg === null) return null;
  const obj = msg as Record<string, unknown>;
  if (obj.type !== "generation_agent_update") return null;
  if (!Array.isArray(obj.agents)) return null;

  const agents: GenerationAgentState[] = [];
  for (const item of obj.agents) {
    const normalized = normalizeAgent(item);
    if (normalized) agents.push(normalized);
  }
  if (agents.length === 0) return null;

  return agents;
}

export function mergeCodeGenerationAgents(
  existing: GenerationAgentState[] | null,
  incoming: GenerationAgentState[],
): GenerationAgentState[] {
  if (!existing || existing.length === 0) {
    return incoming;
  }
  const merged = [...existing];
  for (const agent of incoming) {
    const idx = merged.findIndex((a) => a.agent === agent.agent);
    if (idx >= 0) {
      merged[idx] = agent;
    } else {
      merged.push(agent);
    }
  }
  return merged;
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

export function parseGenerationAgentEvent(msg: unknown): GenerationAgentEvent | null {
  if (typeof msg !== "object" || msg === null) return null;
  const obj = msg as Record<string, unknown>;
  if (obj.type !== "generation_agent_event") return null;
  if (typeof obj.agent !== "string" || !obj.agent) return null;
  if (typeof obj.event_type !== "string" || !obj.event_type) return null;

  const status = obj.status;
  if (typeof status !== "string") return null;

  return {
    agent: obj.agent,
    status,
    event_type: obj.event_type,
    message: typeof obj.message === "string" ? obj.message : "",
    history: obj.history === true,
    started_at: typeof obj.started_at === "string" ? obj.started_at : null,
    completed_at: typeof obj.completed_at === "string" ? obj.completed_at : null,
    ts: typeof obj.ts === "string" ? obj.ts : "",
  };
}

export function reduceGenerationAgentEvent(
  agents: GenerationAgentState[],
  event: GenerationAgentEvent,
): GenerationAgentState[] {
  const idx = agents.findIndex((a) => a.agent === event.agent);
  if (idx === -1) return agents;

  const next = [...agents];
  const current = { ...next[idx] };
  const terminal = event.status === "completed" || event.status === "failed" || event.status === "skipped";

  current.status = event.status as GenerationAgentStatus;
  current.summary = event.message;

  if (event.status === "running") {
    if (current.started_at === null && event.started_at) {
      current.started_at = event.started_at;
    }
    current.completed_at = null;
    current.error = null;
    current.progress_text = event.message;
  } else if (terminal) {
    current.completed_at = event.completed_at ?? current.completed_at;
    current.progress_text = null;
    if (event.status === "failed" && event.message) {
      current.error = event.message;
    }
    if (current.started_at && current.completed_at) {
      try {
        const start = new Date(current.started_at).getTime();
        const end = new Date(current.completed_at).getTime();
        if (!isNaN(start) && !isNaN(end)) {
          current.elapsed_ms = Math.max(0, end - start);
        }
      } catch {
        // ignore date parse errors
      }
    }
  }

  if (event.history && event.message) {
    current.history = [...current.history, event.message].slice(-3);
  }

  next[idx] = current;
  return next;
}
