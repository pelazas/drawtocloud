import type { SupabaseClient } from "@supabase/supabase-js";
import type { Edge, Node } from "reactflow";
import type { ArchDescription } from "@/components/ArchDescriptionViewer";
import type { TerraformFile } from "@/components/OutputPanel";
import type { SetupPdfStatus } from "@/lib/setupPdf";

export type NodeCost = {
  node_id: string;
  label: string;
  cost: number;
  expected_cost?: number;
  instance_type?: string;
  estimated: boolean;
  unpriced?: boolean;
};

export type CostBreakdown = {
  region: string;
  monthly_total: number;
  items: NodeCost[];
  scenarios?: {
    baseline_total: number;
    expected_total: number;
    peak_total: number;
  };
  budget_cap?: number;
  monthly_budget?: number;
  over_budget?: boolean;
};

export type CanvasMessage = {
  role: "user" | "assistant";
  content: string;
  selectedNodes?: Array<{
    id: string;
    label: string;
    category: string;
  }>;
  planReady?: boolean;
  executionMode?: "node_patch" | "architecture_refactor" | "plan_only" | "chat_only";
  planMeta?: {
    plan_id?: string;
    type?: "architecture_refactor" | "node_patch" | string;
    status?: string;
    requested_change?: string;
    selected_node_ids?: string[];
  };
};

export type GenerationStatus = "idle" | "queued" | "running" | "completed" | "failed";
export type ProjectMode = "default" | "discovery";
export type QuestionnaireAnswers = Record<string, string | string[] | number>;

export type PersistedProject = {
  id: string;
  userId: string | null;
  shareSlug: string | null;
  thumbnailUrl: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  questionnaireAnswers: QuestionnaireAnswers;
  nodes: Node[];
  edges: Edge[];
  terraformFiles: TerraformFile[];
  archDescription: ArchDescription | null;
  chatHistory: CanvasMessage[];
  generationStatus: GenerationStatus;
  generationStage: string | null;
  generationError: string | null;
  generationTraceId: string | null;
  generationStartedAt: string | null;
  generationCompletedAt: string | null;
  lastEventAt: string | null;
  projectMode: ProjectMode;
  setupPdfStatus: SetupPdfStatus;
  setupPdfUrl: string | null;
  setupPdfStoragePath: string | null;
  setupPdfGeneratedAt: string | null;
  setupPdfSourceRevision: string | null;
  setupPdfError: string | null;
  setupPdfProgress: number;
  costEstimate: CostBreakdown | null;
};

export type ProjectSummary = {
  id: string;
  shareSlug: string | null;
  thumbnailUrl: string | null;
  title: string;
  createdAt: string;
  monthlyCost: number | null;
  nodeCount: number;
};

export type CanvasSession =
  | {
      mode: "new";
      answers: QuestionnaireAnswers;
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

function parseQuestionnaireAnswers(value: unknown): QuestionnaireAnswers {
  if (!isRecord(value)) return {};
  const normalized: QuestionnaireAnswers = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const single = asNonEmptyString(rawValue);
    if (single !== null) {
      normalized[key] = single;
      continue;
    }

    const numeric = asNumber(rawValue);
    if (numeric !== null) {
      normalized[key] = numeric;
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
    const selectedNodes = Array.isArray(rawEntry.selected_nodes)
      ? rawEntry.selected_nodes
          .filter((entry): entry is Record<string, unknown> => isRecord(entry))
          .map((entry) => ({
            id: asNonEmptyString(entry.id) ?? "",
            label: asNonEmptyString(entry.label) ?? asNonEmptyString(entry.id) ?? "",
            category: asNonEmptyString(entry.category) ?? "default",
          }))
          .filter((entry) => entry.id.length > 0 && entry.label.length > 0)
      : [];

    parsed.push({
      role,
      content,
      ...(selectedNodes.length > 0 ? { selectedNodes } : {}),
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

function parseProjectMode(value: unknown, questionnaireAnswers: QuestionnaireAnswers): ProjectMode {
  if (value === "discovery" || value === "default") {
    return value;
  }

  const legacyMode = questionnaireAnswers._mode;
  if (legacyMode === "chat_first" || legacyMode === "discovery") {
    return "discovery";
  }

  return "default";
}

function parseSetupPdfStatus(value: unknown): SetupPdfStatus {
  if (
    value === "none" ||
    value === "generating" ||
    value === "ready" ||
    value === "failed" ||
    value === "outdated"
  ) {
    return value;
  }
  return "none";
}

function parseCostItems(value: unknown): NodeCost[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .flatMap((entry) => {
      const nodeId = asNonEmptyString(entry.node_id);
      const label = asNonEmptyString(entry.label);
      const cost = asNumber(entry.cost);
      if (!nodeId || !label || cost === null) return [];
      const expectedCost = asNumber(entry.expected_cost);
      const instanceType = asNonEmptyString(entry.instance_type) ?? undefined;
      const estimated = entry.estimated === true;
      const unpriced = entry.unpriced === true;
      return [
        {
          node_id: nodeId,
          label,
          cost,
          ...(expectedCost !== null ? { expected_cost: expectedCost } : {}),
          estimated,
          ...(unpriced ? { unpriced: true } : {}),
          ...(instanceType ? { instance_type: instanceType } : {}),
        },
      ];
    });
}

function parseCostEstimate(value: unknown): CostBreakdown | null {
  if (!isRecord(value)) return null;
  const region = asNonEmptyString(value.region);
  const monthlyTotal = asNumber(value.monthly_total);
  if (!region || monthlyTotal === null) return null;

  const items = parseCostItems(value.items);
  const budgetCap = asNumber(value.budget_cap);
  const monthlyBudget = asNumber(value.monthly_budget);
  const overBudget = value.over_budget === true ? true : value.over_budget === false ? false : undefined;
  const scenarios =
    isRecord(value.scenarios) &&
    asNumber(value.scenarios.baseline_total) !== null &&
    asNumber(value.scenarios.expected_total) !== null &&
    asNumber(value.scenarios.peak_total) !== null
      ? {
          baseline_total: asNumber(value.scenarios.baseline_total) as number,
          expected_total: asNumber(value.scenarios.expected_total) as number,
          peak_total: asNumber(value.scenarios.peak_total) as number,
        }
      : undefined;

  return {
    region,
    monthly_total: monthlyTotal,
    items,
    ...(scenarios ? { scenarios } : {}),
    ...(budgetCap !== null ? { budget_cap: budgetCap } : {}),
    ...(monthlyBudget !== null ? { monthly_budget: monthlyBudget } : {}),
    ...(overBudget !== undefined ? { over_budget: overBudget } : {}),
  };
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
    thumbnailUrl: asNonEmptyString(row.thumbnail_url),
    title,
    createdAt: asNonEmptyString(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: asNonEmptyString(row.updated_at) ?? new Date(0).toISOString(),
    questionnaireAnswers,
    nodes: parseNodes(row.nodes),
    edges: parseEdges(row.edges),
    terraformFiles: parseTerraformFiles(row.terraform_files),
    archDescription: parseArchDescription(row.description),
    chatHistory: parseChatHistory(row.chat_history),
    generationStatus: parseGenerationStatus(row.generation_status),
    generationStage: asNonEmptyString(row.generation_stage),
    generationError: asNonEmptyString(row.generation_error),
    generationTraceId: asNonEmptyString(row.generation_trace_id),
    generationStartedAt: asNonEmptyString(row.generation_started_at),
    generationCompletedAt: asNonEmptyString(row.generation_completed_at),
    lastEventAt: asNonEmptyString(row.last_event_at),
    projectMode: parseProjectMode(row.project_mode, questionnaireAnswers),
    setupPdfStatus: parseSetupPdfStatus(row.setup_pdf_status),
    setupPdfUrl: asNonEmptyString(row.setup_pdf_url),
    setupPdfStoragePath: asNonEmptyString(row.setup_pdf_storage_path),
    setupPdfGeneratedAt: asNonEmptyString(row.setup_pdf_generated_at),
    setupPdfSourceRevision: asNonEmptyString(row.setup_pdf_source_revision),
    setupPdfError: asNonEmptyString(row.setup_pdf_error),
    setupPdfProgress: asNumber(row.setup_pdf_progress) ?? 0,
    costEstimate: parseCostEstimate(row.cost_estimate),
  };
}

export function mapProjectRows(rows: unknown): PersistedProject[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(mapProjectRow).filter((project): project is PersistedProject => project !== null);
}

export function toProjectSummary(project: PersistedProject): ProjectSummary {
  const monthlyTotal = project.costEstimate?.monthly_total ?? 0;
  return {
    id: project.id,
    shareSlug: project.shareSlug,
    thumbnailUrl: project.thumbnailUrl,
    title: project.title,
    createdAt: project.createdAt,
    monthlyCost: monthlyTotal > 0 ? monthlyTotal : null,
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
