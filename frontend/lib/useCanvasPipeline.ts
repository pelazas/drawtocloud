import { useCallback, useEffect, useRef, useState } from "react";
import { useDiagramState } from "@/lib/useDiagramState";
import wsClient, { ConnectionState } from "@/lib/websocket";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { TerraformFile, CostEstimate } from "@/components/OutputPanel";
import { ArchDescription } from "@/components/ArchDescriptionViewer";
import { CanvasMessage, CanvasSession } from "@/lib/projects";

export type AgentLogEntry = {
  id: number;
  agent: "requirements" | "architect" | "coder" | "cost_analyst" | "description";
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

type CanvasPipelineOptions = {
  liveSession?: boolean;
  readOnly?: boolean;
};

type StartGenerationResponse = {
  project_id: string;
  share_slug: string | null;
  trace_id: string;
  generation_status: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const STALL_THRESHOLD_MS = 15_000;
const TERRAFORM_EXPECTED_MIN_FILES = 4;

function upsertTerraformFile(existing: TerraformFile[], incoming: TerraformFile): TerraformFile[] {
  const index = existing.findIndex((file) => file.filename === incoming.filename);
  if (index === -1) {
    return [...existing, incoming];
  }

  const next = [...existing];
  next[index] = incoming;
  return next;
}

function hasInvalidNodePositions(nodes: { position?: { x?: unknown; y?: unknown } }[]): boolean {
  if (nodes.length === 0) return false;

  let allZero = true;
  for (const node of nodes) {
    const x = Number(node.position?.x);
    const y = Number(node.position?.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
    if (x !== 0 || y !== 0) allZero = false;
  }

  return allZero;
}

async function withAccessToken(payload: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  return {
    ...payload,
    access_token: data.session?.access_token,
  };
}

async function startGenerationViaHttp(
  answers: Record<string, string | string[]>,
  projectId?: string | null
): Promise<StartGenerationResponse> {
  const payload = await withAccessToken({
    answers,
    project_id: projectId ?? undefined,
  });

  const response = await fetch(`${API_URL}/api/generations/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as
    | StartGenerationResponse
    | { detail?: { error?: string; message?: string } };

  if (!response.ok) {
    const detail = (body as { detail?: { error?: string; message?: string } }).detail;
    throw new Error(detail?.message ?? detail?.error ?? "Failed to start generation");
  }

  return body as StartGenerationResponse;
}

function getSessionKey(canvasSession: CanvasSession): string {
  if (canvasSession.mode === "existing") {
    return `existing:${canvasSession.project.id}`;
  }

  return `new:${canvasSession.projectId ?? "none"}:${JSON.stringify(canvasSession.answers)}`;
}

export function useCanvasPipeline(
  appState: "dashboard" | "questionnaire" | "canvas",
  canvasSession: CanvasSession | null,
  onGenerationComplete?: () => void | Promise<void>,
  onProjectReady?: (projectId: string, shareSlug: string | null) => void,
  options?: CanvasPipelineOptions
) {
  const diagram = useDiagramState();
  const { reset, applyLayout, handleDiagramEvent, hydrate } = diagram;
  const liveSession = options?.liveSession ?? false;
  const readOnly = options?.readOnly ?? false;

  const [messages, setMessages] = useState<CanvasMessage[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [terraformFiles, setTerraformFiles] = useState<TerraformFile[]>([]);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [archDescription, setArchDescription] = useState<ArchDescription | null>(null);
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [streamingAssistantReply, setStreamingAssistantReply] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [generationElapsed, setGenerationElapsed] = useState<number>(0);

  const [wsState, setWsState] = useState<ConnectionState>("idle");
  const [statusTicker, setStatusTicker] = useState<string[]>([]);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [terraformProgress, setTerraformProgress] = useState<TerraformProgress>({
    status: "idle",
    activity: null,
    emittedCount: 0,
    expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
    currentFile: null,
    lastUpdateAt: null,
  });

  const generationStartRef = useRef<number>(0);
  const activeSessionKeyRef = useRef<string | null>(null);
  const generationRequestKeyRef = useRef<string | null>(null);
  const subscribedProjectRef = useRef<string | null>(null);
  const lastHydratedUpdatedAtRef = useRef<string | null>(null);
  const stallWarnedRef = useRef(false);
  const streamingReplyRef = useRef("");

  const pushTicker = useCallback((message: string) => {
    setStatusTicker((prev) => [...prev, message].slice(-20));
  }, []);

  const pushDebugEvent = useCallback((event: Omit<DebugEvent, "id">) => {
    setDebugEvents((prev) => [...prev, { ...event, id: Date.now() + Math.random() }].slice(-200));
  }, []);

  const recordDebugEvent = useCallback(
    (
      message: string,
      options?: {
        level?: DebugEvent["level"];
        stage?: string | null;
        details?: Record<string, unknown>;
      }
    ) => {
      pushDebugEvent({
        ts: Date.now(),
        level: options?.level ?? "info",
        source: "local",
        stage: options?.stage ?? currentStage,
        message,
        traceId,
        details: options?.details,
      });
    },
    [currentStage, pushDebugEvent, traceId]
  );

  const subscribeProject = useCallback(async (projectId: string) => {
    const payload = await withAccessToken({ type: "subscribe_project", project_id: projectId });
    wsClient.send(payload);
    subscribedProjectRef.current = projectId;
  }, []);

  useEffect(() => {
    if (appState !== "canvas" || !canvasSession) return;

    const sessionKey = getSessionKey(canvasSession);
    const isFreshSession = activeSessionKeyRef.current !== sessionKey;
    activeSessionKeyRef.current = sessionKey;

    if (readOnly && canvasSession.mode === "existing") {
      if (isFreshSession || canvasSession.project.updatedAt !== lastHydratedUpdatedAtRef.current) {
        setMessages(canvasSession.project.chatHistory);
        setTerraformFiles(canvasSession.project.terraformFiles);
        setCostEstimate(canvasSession.project.costEstimate);
        setArchDescription(canvasSession.project.archDescription);
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        hydrate(canvasSession.project.nodes, canvasSession.project.edges);
        if (hasInvalidNodePositions(canvasSession.project.nodes)) {
          applyLayout();
        }
        lastHydratedUpdatedAtRef.current = canvasSession.project.updatedAt;
      }

      setTraceId(canvasSession.project.generationTraceId);
      setCurrentStage(canvasSession.project.generationStage);
      setLastEventAt(canvasSession.project.lastEventAt ? Date.parse(canvasSession.project.lastEventAt) : Date.now());

      const generationActive =
        canvasSession.project.generationStatus === "queued" ||
        canvasSession.project.generationStatus === "running";
      if (generationActive) {
        setIsGenerating(true);
        setPipelineStatus("Shared project is still generating...");
        setTerraformProgress((prev) => ({
          ...prev,
          status: "generating",
          activity: canvasSession.project.generationStage
            ? `Running ${canvasSession.project.generationStage}`
            : "Generation running",
          emittedCount: canvasSession.project.terraformFiles.length,
          expectedMinFiles: Math.max(prev.expectedMinFiles, TERRAFORM_EXPECTED_MIN_FILES),
          currentFile: null,
          lastUpdateAt: canvasSession.project.lastEventAt
            ? Date.parse(canvasSession.project.lastEventAt)
            : Date.now(),
        }));
      } else {
        setIsGenerating(false);
        setPipelineStatus("Viewing shared project");
        setTerraformProgress((prev) => ({
          ...prev,
          status: canvasSession.project.terraformFiles.length > 0 ? "completed" : "idle",
          activity: canvasSession.project.terraformFiles.length > 0 ? "Terraform ready" : null,
          emittedCount: canvasSession.project.terraformFiles.length,
          currentFile: null,
          lastUpdateAt: Date.now(),
        }));
      }

      return;
    }

    wsClient.connect();

    const unsubscribeConnection = wsClient.onConnectionState((state) => {
      setWsState(state);
      pushDebugEvent({
        ts: Date.now(),
        level: state === "error" ? "error" : "info",
        source: "ws",
        stage: currentStage,
        message: `WebSocket state: ${state}`,
        traceId,
      });

      if (state !== "open") {
        subscribedProjectRef.current = null;
      }
    });

    let unsubscribeOpen: (() => void) | undefined;

    if (canvasSession.mode === "new") {
      if (isFreshSession) {
        reset();
        setPipelineStatus("Starting generation...");
        setMessages([]);
        setTerraformFiles([]);
        setCostEstimate(null);
        setArchDescription(null);
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        setAgentLogs([]);
        setGenerationElapsed(0);
        setStatusTicker([]);
        setDebugEvents([]);
        setCurrentStage("start");
        setTraceId(null);
        setTerraformProgress({
          status: "planning",
          activity: "Planning Terraform files",
          emittedCount: 0,
          expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
          currentFile: null,
          lastUpdateAt: Date.now(),
        });
        setIsGenerating(true);
        generationStartRef.current = Date.now();
        setLastEventAt(Date.now());
        stallWarnedRef.current = false;
      }

      void (async () => {
        if (generationRequestKeyRef.current === sessionKey) return;
        generationRequestKeyRef.current = sessionKey;

        try {
          const result = await startGenerationViaHttp(canvasSession.answers, canvasSession.projectId ?? undefined);
          setTraceId(result.trace_id);
          setCurrentStage("queued");
          setPipelineStatus("Generation queued...");
          pushTicker("queued");
          setTerraformProgress((prev) => ({
            ...prev,
            status: "planning",
            activity: "Queued for generation",
            lastUpdateAt: Date.now(),
          }));
          pushDebugEvent({
            ts: Date.now(),
            level: "info",
            source: "pipeline",
            stage: "queued",
            message: `Generation started (trace ${result.trace_id})`,
            traceId: result.trace_id,
          });

          if (result.project_id) {
            if (wsState === "open") {
              await subscribeProject(result.project_id);
            } else {
              unsubscribeOpen = wsClient.onOpen(() => {
                void subscribeProject(result.project_id);
              });
            }
          }

          onProjectReady?.(result.project_id, result.share_slug);
        } catch (error) {
          setIsGenerating(false);
          setPipelineStatus(`Error: ${(error as Error).message}`);
          pushTicker("error");
          pushDebugEvent({
            ts: Date.now(),
            level: "error",
            source: "pipeline",
            stage: "start",
            message: (error as Error).message,
            traceId: traceId,
          });
        }
      })();
    } else {
      const generationActive =
        liveSession ||
        canvasSession.project.generationStatus === "queued" ||
        canvasSession.project.generationStatus === "running";

      const shouldHydrateFromProject =
        isFreshSession ||
        (canvasSession.project.updatedAt !== lastHydratedUpdatedAtRef.current && (!liveSession || wsState !== "open"));

      if (shouldHydrateFromProject) {
        setMessages(canvasSession.project.chatHistory);
        setTerraformFiles(canvasSession.project.terraformFiles);
        setCostEstimate(canvasSession.project.costEstimate);
        setArchDescription(canvasSession.project.archDescription);
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        hydrate(canvasSession.project.nodes, canvasSession.project.edges);
        if (hasInvalidNodePositions(canvasSession.project.nodes)) {
          applyLayout();
        }
        lastHydratedUpdatedAtRef.current = canvasSession.project.updatedAt;
      }

      setTraceId(canvasSession.project.generationTraceId);
      setCurrentStage(canvasSession.project.generationStage);
      setLastEventAt(canvasSession.project.lastEventAt ? Date.parse(canvasSession.project.lastEventAt) : Date.now());

      if (generationActive) {
        setIsGenerating(true);
        setPipelineStatus((prev) => prev ?? "Resuming generation...");
        pushTicker(canvasSession.project.generationStage ?? canvasSession.project.generationStatus);
        setTerraformProgress((prev) => ({
          ...prev,
          status: "generating",
          activity: canvasSession.project.generationStage
            ? `Running ${canvasSession.project.generationStage}`
            : "Generating Terraform files",
          emittedCount: canvasSession.project.terraformFiles.length,
          expectedMinFiles: Math.max(prev.expectedMinFiles, TERRAFORM_EXPECTED_MIN_FILES),
          currentFile: null,
          lastUpdateAt: canvasSession.project.lastEventAt
            ? Date.parse(canvasSession.project.lastEventAt)
            : Date.now(),
        }));
      } else {
        setIsGenerating(false);
        setPipelineStatus((prev) => prev ?? "Loaded saved project");
        setTerraformProgress((prev) => ({
          ...prev,
          status: canvasSession.project.terraformFiles.length > 0 ? "completed" : "idle",
          activity: canvasSession.project.terraformFiles.length > 0 ? "Terraform ready" : null,
          emittedCount: canvasSession.project.terraformFiles.length,
          currentFile: null,
          lastUpdateAt: Date.now(),
        }));
      }

      const projectId = canvasSession.project.id;
      if (wsState === "open") {
        void subscribeProject(projectId);
      } else {
        unsubscribeOpen = wsClient.onOpen(() => {
          void subscribeProject(projectId);
        });
      }
    }

    const unsubscribeMessages = wsClient.onMessage((data: unknown) => {
      const msg = data as Record<string, unknown>;
      const targetProjectId =
        canvasSession.mode === "existing" ? canvasSession.project.id : canvasSession.projectId ?? null;

      if (typeof msg.project_id === "string" && targetProjectId && msg.project_id !== targetProjectId) {
        return;
      }

      const incomingTrace = typeof msg.trace_id === "string" ? msg.trace_id : null;
      if (incomingTrace) {
        setTraceId(incomingTrace);
      }

      if (msg.type === "generation_snapshot") {
        const status = msg.generation_status;
        const stage = msg.generation_stage;
        if (typeof stage === "string") setCurrentStage(stage);
        if (status === "queued" || status === "running") {
          setIsGenerating(true);
          setPipelineStatus(typeof stage === "string" ? `Running: ${stage}` : "Generation running...");
          setTerraformProgress((prev) => ({
            ...prev,
            status: "generating",
            activity: typeof stage === "string" ? `Running ${stage}` : "Generation running",
            lastUpdateAt: Date.now(),
          }));
        }
        if (status === "completed") {
          setIsGenerating(false);
          setPipelineStatus("Architecture ready ✓");
          setTerraformProgress((prev) => ({
            ...prev,
            status: "completed",
            activity: "Terraform ready",
            emittedCount: prev.emittedCount,
            currentFile: null,
            lastUpdateAt: Date.now(),
          }));
        }
        if (status === "failed") {
          setIsGenerating(false);
          setPipelineStatus(`Error: ${String(msg.generation_error ?? "Generation failed")}`);
          setTerraformProgress((prev) => ({
            ...prev,
            status: "failed",
            activity: String(msg.generation_error ?? "Generation failed"),
            currentFile: null,
            lastUpdateAt: Date.now(),
          }));
        }
        setLastEventAt(Date.now());
      }

      if (msg.type === "project_ready") {
        const projectId = msg.project_id;
        const shareSlug = msg.share_slug;
        if (typeof projectId === "string") {
          onProjectReady?.(projectId, typeof shareSlug === "string" ? shareSlug : null);
          setLastEventAt(Date.now());
        }
      }

      if (msg.type === "generation_started") {
        setIsGenerating(true);
        setPipelineStatus("Generation queued...");
        setCurrentStage("queued");
        setLastEventAt(Date.now());
        pushTicker("queued");
        setTerraformProgress((prev) => ({
          ...prev,
          status: "planning",
          activity: "Queued for generation",
          emittedCount: 0,
          expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
          currentFile: null,
          lastUpdateAt: Date.now(),
        }));
      }

      if (msg.type === "pipeline_event") {
        const stage = typeof msg.stage === "string" ? msg.stage : null;
        const eventName = typeof msg.event === "string" ? msg.event : null;
        const level = msg.level === "warning" || msg.level === "error" ? msg.level : "info";
        const message = typeof msg.message === "string" ? msg.message : "Pipeline event";
        const details =
          typeof msg.details === "object" && msg.details !== null
            ? (msg.details as Record<string, unknown>)
            : undefined;
        setCurrentStage(stage);
        setLastEventAt(Date.now());
        stallWarnedRef.current = false;
        pushTicker(stage ? `${stage}:${String(eventName ?? "event")}` : message);
        pushDebugEvent({
          ts: Date.now(),
          level,
          source: "pipeline",
          stage,
          message,
          traceId: incomingTrace ?? traceId,
          details,
        });

        if (stage === "coder") {
          const expectedFromEvent =
            typeof details?.expected_min_files === "number"
              ? details.expected_min_files
              : TERRAFORM_EXPECTED_MIN_FILES;
          const emittedFromEvent = typeof details?.emitted_count === "number" ? details.emitted_count : null;
          const currentFile = typeof details?.current_file === "string" ? details.current_file : null;
          const activity =
            typeof details?.activity === "string" && details.activity.trim().length > 0
              ? details.activity
              : message;

          setTerraformProgress((prev) => {
            let status: TerraformProgress["status"] = prev.status;
            if (eventName === "coder.started") status = "planning";
            if (eventName === "coder.llm_request_started") status = "requesting";
            if (eventName === "coder.first_file_emitted" || eventName === "coder.file_emitted") status = "generating";
            if (eventName === "coder.completed") status = "finalizing";
            if (level === "error" && (eventName === "coder.parse_fallback" || eventName === "coder.timeout_fallback")) {
              status = "failed";
            }

            return {
              status,
              activity,
              emittedCount: emittedFromEvent ?? prev.emittedCount,
              expectedMinFiles: Math.max(prev.expectedMinFiles, expectedFromEvent),
              currentFile,
              lastUpdateAt: Date.now(),
            };
          });
        }

        if (level === "error") {
          setPipelineStatus(`Error: ${message}`);
        } else {
          setPipelineStatus(message);
        }
      }

      if (msg.type === "status") {
        const message = msg.message as string;
        setPipelineStatus(message);
        setLastEventAt(Date.now());
        setIsGenerating(true);
        pushTicker(message);
      }

      if (msg.type === "done") {
        setIsGenerating(false);
        setPipelineStatus("Architecture ready ✓");
        const startedAt = generationStartRef.current || Date.now();
        setGenerationElapsed((Date.now() - startedAt) / 1000);
        setLastEventAt(Date.now());
        pushTicker("done");
        setTerraformProgress((prev) => ({
          ...prev,
          status: "completed",
          activity: "Terraform generation complete",
          currentFile: null,
          emittedCount: prev.emittedCount,
          lastUpdateAt: Date.now(),
        }));
        applyLayout();

        if (onGenerationComplete) {
          void onGenerationComplete();
        }
      }

      if (msg.type === "error") {
        const message = String(msg.message ?? "Unknown error");
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        setIsGenerating(false);
        setPipelineStatus(`Error: ${message}`);
        setLastEventAt(Date.now());
        pushTicker("error");
        setTerraformProgress((prev) => ({
          ...prev,
          status: "failed",
          activity: message,
          currentFile: null,
          lastUpdateAt: Date.now(),
        }));
        pushDebugEvent({
          ts: Date.now(),
          level: "error",
          source: "pipeline",
          stage: currentStage,
          message,
          traceId: incomingTrace ?? traceId,
          details: { error: msg.error as string },
        });
      }

      if (msg.type === "agent_log") {
        setAgentLogs((prev) => {
          const entry: AgentLogEntry = {
            id: Date.now() + Math.random(),
            agent: msg.agent as AgentLogEntry["agent"],
            message: msg.message as string,
            elapsed: msg.elapsed as number,
          };
          return [...prev, entry].slice(-50);
        });
        setLastEventAt(Date.now());
      }

      if (msg.type === "terraform_file") {
        setTerraformFiles((prev) => {
          const next = upsertTerraformFile(prev, msg as unknown as TerraformFile);
          setTerraformProgress((progress) => ({
            ...progress,
            status: "generating",
            activity:
              typeof (msg as { filename?: unknown }).filename === "string"
                ? `Generating ${(msg as { filename: string }).filename}`
                : "Generating Terraform files",
            emittedCount: next.length,
            expectedMinFiles: Math.max(progress.expectedMinFiles, TERRAFORM_EXPECTED_MIN_FILES),
            currentFile: typeof (msg as { filename?: unknown }).filename === "string" ? (msg as { filename: string }).filename : null,
            lastUpdateAt: Date.now(),
          }));
          return next;
        });
        setLastEventAt(Date.now());
      }

      if (msg.type === "cost_estimate") {
        setCostEstimate((msg as { type: string; data: CostEstimate }).data);
        setLastEventAt(Date.now());
      }

      if (msg.type === "arch_description") {
        setArchDescription((msg as { type: string; sections: ArchDescription }).sections);
        setLastEventAt(Date.now());
      }

      if (msg.type === "diagram_event") {
        handleDiagramEvent(msg);
        setLastEventAt(Date.now());
      }

      if (msg.type === "chat_reply_delta") {
        const delta = typeof msg.delta === "string" ? msg.delta : "";
        if (delta) {
          setIsChatStreaming(true);
          setStreamingAssistantReply((prev) => {
            const next = prev + delta;
            streamingReplyRef.current = next;
            return next;
          });
          setLastEventAt(Date.now());
        }
      }

      if (msg.type === "chat_reply_done") {
        const finalMessage =
          typeof msg.message === "string" && msg.message.trim()
            ? msg.message
            : streamingReplyRef.current;
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        if (finalMessage.trim()) {
          setMessages((prev) => [...prev, { role: "assistant", content: finalMessage }]);
        }
        setLastEventAt(Date.now());
      }

      if (msg.type === "chat_reply") {
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        setMessages((prev) => [...prev, { role: "assistant", content: msg.message as string }]);
        setLastEventAt(Date.now());
      }
    });

    return () => {
      unsubscribeMessages();
      unsubscribeConnection();
      unsubscribeOpen?.();
    };
  }, [
    appState,
    canvasSession,
    liveSession,
    readOnly,
    onGenerationComplete,
    onProjectReady,
    reset,
    applyLayout,
    handleDiagramEvent,
    hydrate,
    pushDebugEvent,
    pushTicker,
    subscribeProject,
  ]);

  useEffect(() => {
    if (!isGenerating) return;

    const timer = setInterval(() => {
      if (!lastEventAt) return;
      const age = Date.now() - lastEventAt;
      if (age < STALL_THRESHOLD_MS || stallWarnedRef.current) {
        return;
      }

      stallWarnedRef.current = true;
      setPipelineStatus("Stalled: no events for 15s. Check Debug panel.");
      pushTicker("stall-warning");
      pushDebugEvent({
        ts: Date.now(),
        level: "warning",
        source: "local",
        stage: currentStage,
        message:
          "No pipeline events for 15s. Check browser console/network WS and backend logs filtered by trace_id.",
        traceId,
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isGenerating, lastEventAt, currentStage, traceId, pushDebugEvent, pushTicker]);

  const handleReconnect = useCallback(() => {
    pushDebugEvent({
      ts: Date.now(),
      level: "info",
      source: "local",
      stage: currentStage,
      message: "Manual websocket reconnect requested",
      traceId,
    });
    wsClient.reconnect();
  }, [currentStage, pushDebugEvent, traceId]);

  const copyDebugReport = useCallback(async () => {
    const latestPollEvent = [...debugEvents]
      .reverse()
      .find((event) => typeof event.details?.poll_mode === "string");
    const latestCoderEvent = [...debugEvents]
      .reverse()
      .find((event) => event.stage === "coder");

    const lines = [
      `trace_id: ${traceId ?? "n/a"}`,
      `ws_state: ${wsState}`,
      `current_stage: ${currentStage ?? "n/a"}`,
      `status: ${pipelineStatus ?? "n/a"}`,
      `poll_mode: ${typeof latestPollEvent?.details?.poll_mode === "string" ? latestPollEvent.details.poll_mode : "n/a"}`,
      `coder_last_milestone: ${latestCoderEvent?.message ?? "n/a"}`,
      `event_count: ${debugEvents.length}`,
      "",
      ...debugEvents.map((event) => {
        const when = new Date(event.ts).toISOString();
        return `${when} [${event.level}] (${event.source}) stage=${event.stage ?? "n/a"} trace=${event.traceId ?? "n/a"} :: ${event.message}`;
      }),
    ];

    const report = lines.join("\n");
    try {
      await navigator.clipboard.writeText(report);
      pushDebugEvent({
        ts: Date.now(),
        level: "info",
        source: "local",
        stage: currentStage,
        message: "Copied debug report to clipboard",
        traceId,
      });
    } catch {
      pushDebugEvent({
        ts: Date.now(),
        level: "warning",
        source: "local",
        stage: currentStage,
        message: "Failed to copy debug report",
        traceId,
      });
    }
  }, [currentStage, debugEvents, pipelineStatus, pushDebugEvent, traceId, wsState]);

  const activeProjectId =
    canvasSession?.mode === "existing" ? canvasSession.project.id : canvasSession?.projectId ?? null;
  const generationCompleted =
    currentStage === "completed" ||
    (canvasSession?.mode === "existing" && canvasSession.project.generationStage === "completed");
  const chatEnabled =
    !readOnly && Boolean(activeProjectId) && generationCompleted && !isGenerating && !isChatStreaming;
  const chatDisabledReason = readOnly
    ? "Read-only shared view."
    : !activeProjectId
      ? "Chat will unlock once this project is created."
      : !generationCompleted || isGenerating
        ? "Chat unlocks once generation is completed."
        : isChatStreaming
          ? "Assistant is replying..."
          : null;
  const displayedMessages = streamingAssistantReply
    ? [...messages, { role: "assistant" as const, content: streamingAssistantReply }]
    : messages;

  function handleSend(message: string) {
    if (!chatEnabled) return;
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setIsChatStreaming(true);
    setStreamingAssistantReply("");
    streamingReplyRef.current = "";
    const projectId = canvasSession?.mode === "existing" ? canvasSession.project.id : canvasSession?.projectId;
    void (async () => {
      const payload = await withAccessToken({ type: "chat", message, project_id: projectId ?? undefined });
      wsClient.send(payload);
    })();
  }

  return {
    ...diagram,
    messages: displayedMessages,
    pipelineStatus,
    terraformFiles,
    costEstimate,
    archDescription,
    terraformProgress,
    isGenerating,
    agentLogs,
    generationElapsed,
    wsState,
    statusTicker,
    debugEvents,
    currentStage,
    traceId,
    lastEventAt,
    handleReconnect,
    copyDebugReport,
    recordDebugEvent,
    isChatStreaming,
    chatEnabled,
    chatDisabledReason,
    handleSend,
  };
}
