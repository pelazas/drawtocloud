import type { SupabaseClient } from "@supabase/supabase-js";
import type { Edge, Node } from "reactflow";
import type { ArchDescription } from "@/components/ArchDescriptionViewer";
import type { CostEstimate, TerraformFile } from "@/components/OutputPanel";

export type CanvasMessage = {
  role: "user" | "assistant";
  content: string;
  planReady?: boolean;
  executionMode?: "node_patch" | "architecture_refactor" | "plan_only" | "chat_only";
  planMeta?: {
    plan_id?: string;
    type?: string;
    status?: string;
    requested_change?: string;
  };
};

export type GenerationStatus = "idle" | "queued" | "running" | "completed" | "failed";

export type PersistedProject = {
  id: string;
  userId: string | null;
  shareSlug: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  questionnaireAnswers: Record<string, string | string[]>;
  nodes: Node[];
  edges: Edge[];
  terraformFiles: TerraformFile[];
  costEstimate: CostEstimate | null;
  archDescription: ArchDescription | null;
  chatHistory: CanvasMessage[];
  generationStatus: GenerationStatus;
  generationStage: string | null;
  generationError: string | null;
  generationTraceId: string | null;
  generationStartedAt: string | null;
  generationCompletedAt: string | null;
  lastEventAt: string | null;
};

export type ProjectSummary = {
  id: string;
  shareSlug: string | null;
  title: string;
  createdAt: string;
  monthlyCost: number | null;
  nodeCount: number;
};

export type CanvasSession =
  | {
      mode: "new";
      answers: Record<string, string | string[]>;
      projectId: string | null;
      shareSlug: string | null;
    }
  | {
      mode: "chat_first";
      answers: Record<string, string | string[]>;
      projectId: string | null;
      shareSlug: string | null;
    }
  | {
      mode: "existing";
      project: PersistedProject;
    };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseQuestionnaireAnswers(value: unknown): Record<string, string | string[]> {
  if (!isRecord(value)) return {};
  const normalized: Record<string, string | string[]> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const single = asNonEmptyString(rawValue);
    if (single !== null) {
      normalized[key] = single;
      continue;
    }

    const multiple = asStringArray(rawValue);
    if (multiple.length > 0) {
      normalized[key] = multiple;
    }
  }

  return normalized;
}

function parseNodes(value: unknown): Node[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((node) => node as unknown as Node);
}

function parseEdges(value: unknown): Edge[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((edge) => edge as unknown as Edge);
}

function parseTerraformFiles(value: unknown): TerraformFile[] {
  if (Array.isArray(value)) {
    return value
      .filter(isRecord)
      .map((entry, index) => {
        const filename = asNonEmptyString(entry.filename) ?? `file-${index + 1}.tf`;
        const content = typeof entry.content === "string" ? entry.content : "";
        const description = typeof entry.description === "string" ? entry.description : "";
        return { filename, content, description };
      });
  }

  if (isRecord(value)) {
    const preferredOrder = ["main.tf", "variables.tf", "outputs.tf", "terraform.tfvars", "versions.tf"];
    const rank = (filename: string) => {
      const idx = preferredOrder.indexOf(filename);
      return idx === -1 ? preferredOrder.length : idx;
    };

    return Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
      .map(([filename, content]) => ({ filename, content, description: "" }))
      .sort((a, b) => {
        const byRank = rank(a.filename) - rank(b.filename);
        if (byRank !== 0) return byRank;
        return a.filename.localeCompare(b.filename);
      });
  }

  return [];
}

function parseCostEstimate(value: unknown): CostEstimate | null {
  if (!isRecord(value)) return null;

  const monthlyTotal = asNumber(value.monthly_total);
  if (monthlyTotal === null) return null;

  const lineItems = Array.isArray(value.line_items)
    ? value.line_items
        .filter(isRecord)
        .map((item) => ({
          service: asNonEmptyString(item.service) ?? "Unknown service",
          resource_type: asNonEmptyString(item.resource_type) ?? "Unknown resource",
          monthly_cost: asNumber(item.monthly_cost) ?? 0,
        }))
    : [];

  const note = asNonEmptyString(value.note);

  return {
    monthly_total: monthlyTotal,
    currency: asNonEmptyString(value.currency) ?? "USD",
    line_items: lineItems,
    generated_by: asNonEmptyString(value.generated_by) ?? "unknown",
    ...(note ? { note } : {}),
  };
}

function parseChatHistory(value: unknown): CanvasMessage[] {
  if (!Array.isArray(value)) return [];
  const parsed: CanvasMessage[] = [];

  for (const rawEntry of value) {
    if (!isRecord(rawEntry)) continue;
    const role = rawEntry.role === "user" || rawEntry.role === "assistant" ? rawEntry.role : null;
    const content = typeof rawEntry.content === "string" ? rawEntry.content : null;
    if (!role || content === null) continue;

    const planReady = rawEntry.plan_ready === true || rawEntry.planReady === true;
    const executionMode =
      rawEntry.execution_mode === "node_patch" ||
      rawEntry.execution_mode === "architecture_refactor" ||
      rawEntry.execution_mode === "plan_only" ||
      rawEntry.execution_mode === "chat_only"
        ? (rawEntry.execution_mode as CanvasMessage["executionMode"])
        : undefined;
    const planMeta =
      typeof rawEntry.plan_meta === "object" && rawEntry.plan_meta !== null
        ? (rawEntry.plan_meta as CanvasMessage["planMeta"])
        : undefined;

    parsed.push({
      role,
      content,
      ...(planReady ? { planReady } : {}),
      ...(executionMode ? { executionMode } : {}),
      ...(planMeta ? { planMeta } : {}),
    });
  }

  return parsed;
}

function parseArchDescription(value: unknown): ArchDescription | null {
  let parsed = value;

  if (typeof value === "string" && value.trim()) {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!isRecord(parsed)) return null;

  const overview = asNonEmptyString(parsed.overview);
  const keyComponents = asNonEmptyString(parsed.key_components);
  const tradeoffs = asNonEmptyString(parsed.tradeoffs);
  const nextSteps = asNonEmptyString(parsed.next_steps);

  if (!overview || !keyComponents || !tradeoffs || !nextSteps) return null;

  return {
    overview,
    key_components: keyComponents,
    tradeoffs,
    next_steps: nextSteps,
  };
}

function parseGenerationStatus(value: unknown): GenerationStatus {
  if (value === "queued" || value === "running" || value === "completed" || value === "failed") {
    return value;
  }
  return "idle";
}

export function mapProjectRow(row: unknown): PersistedProject | null {
  if (!isRecord(row)) return null;
  const id = asNonEmptyString(row.id);
  if (!id) return null;

  const questionnaireAnswers = parseQuestionnaireAnswers(row.questionnaire_answers);
  const title =
    asNonEmptyString(row.title) ??
    asNonEmptyString(questionnaireAnswers.app_name) ??
    "Untitled Project";

  return {
    id,
    userId: asNonEmptyString(row.user_id),
    shareSlug: asNonEmptyString(row.share_slug),
    title,
    createdAt: asNonEmptyString(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: asNonEmptyString(row.updated_at) ?? new Date(0).toISOString(),
    questionnaireAnswers,
    nodes: parseNodes(row.nodes),
    edges: parseEdges(row.edges),
    terraformFiles: parseTerraformFiles(row.terraform_files),
    costEstimate: parseCostEstimate(row.cost_estimate),
    archDescription: parseArchDescription(row.description),
    chatHistory: parseChatHistory(row.chat_history),
    generationStatus: parseGenerationStatus(row.generation_status),
    generationStage: asNonEmptyString(row.generation_stage),
    generationError: asNonEmptyString(row.generation_error),
    generationTraceId: asNonEmptyString(row.generation_trace_id),
    generationStartedAt: asNonEmptyString(row.generation_started_at),
    generationCompletedAt: asNonEmptyString(row.generation_completed_at),
    lastEventAt: asNonEmptyString(row.last_event_at),
  };
}

export function mapProjectRows(rows: unknown): PersistedProject[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(mapProjectRow).filter((project): project is PersistedProject => project !== null);
}

export function toProjectSummary(project: PersistedProject): ProjectSummary {
  return {
    id: project.id,
    shareSlug: project.shareSlug,
    title: project.title,
    createdAt: project.createdAt,
    monthlyCost: project.costEstimate?.monthly_total ?? null,
    nodeCount: project.nodes.length,
  };
}

export async function deleteProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}
