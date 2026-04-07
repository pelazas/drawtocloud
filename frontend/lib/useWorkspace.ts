"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspacePanels } from "./useWorkspacePanels";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/useAuth";
import {
  isQuotaExceededError,
  resolveProjectRedirectPath,
  startGenerationViaHttp,
} from "@/lib/generationStart";
import { createProject, saveSnapshot } from "@/lib/projectApi";
import {
  type CanvasSession,
  type PersistedProject,
  mapProjectRows,
  toProjectSummary,
} from "@/lib/projects";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useCanvasPipeline } from "@/lib/useCanvasPipeline";
import { useQuota } from "@/lib/useQuota";
import {
  shouldRedirectOnProjectReady,
  shouldRedirectUnauthenticatedRootToLogin,
} from "@/lib/workspaceRedirect";

export type RightPanelTab = "output" | "designs" | "templates";

function currentPathWithQuery() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

export function useWorkspace() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectSlug = searchParams.get("project");

  const [currentProject, setCurrentProject] = useState<PersistedProject | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectNotFound, setProjectNotFound] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);

  const [projects, setProjects] = useState<PersistedProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);


  const { generationsUsed, generationsLimit, hasApiKey, quotaLoading, refreshQuota } = useQuota(user);
  const remainingGenerations = Math.max(generationsLimit - generationsUsed, 0);

  const isOwner = useMemo(
    () => Boolean(user?.id && currentProject?.userId && user.id === currentProject.userId),
    [currentProject?.userId, user?.id]
  );

  const canvasSession: CanvasSession | null = useMemo(() => {
    if (!currentProject) return null;
    return { mode: "existing", project: currentProject };
  }, [currentProject]);

  const handleProjectReady = useCallback(
    (projectId: string, shareSlug: string | null) => {
      if (
        !shouldRedirectOnProjectReady({
          shareSlug,
          projectSlug,
          currentProjectId: currentProject?.id ?? null,
          readyProjectId: projectId,
        })
      ) {
        return;
      }
      router.replace(resolveProjectRedirectPath(shareSlug));
    },
    [currentProject, projectSlug, router]
  );

  const pipeline = useCanvasPipeline(
    currentProject ? "canvas" : "dashboard",
    canvasSession,
    refreshQuota,
    handleProjectReady,
    {
      liveSession: Boolean(currentProject && isOwner),
      readOnly: currentProject ? !isOwner : !user,
    }
  );
  const { loadTemplateSnapshot, reset, nodes, edges } = pipeline;
  const canvasBecameNonEmptyRef = useRef(false);
  const defaultTemplateFetchActiveRef = useRef(false);
  const rootProjectResolveInFlightRef = useRef(false);

  const loadProjectBySlug = useCallback(async (slug: string) => {
    setProjectLoading(true);
    setProjectNotFound(false);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.from("projects").select("*").eq("share_slug", slug).single();

      if (error || !data) {
        setCurrentProject(null);
        setProjectNotFound(true);
        return;
      }

      const mapped = mapProjectRows([data]);
      if (mapped.length === 0) {
        setCurrentProject(null);
        setProjectNotFound(true);
        return;
      }

      const nextProject = mapped[0];
      setCurrentProject(nextProject);
      setProjectNotFound(false);

      if (user?.id && nextProject.userId === user.id) {
        await supabase
          .from("projects")
          .update({ last_opened_at: new Date().toISOString() })
          .eq("id", nextProject.id);
      }
    } finally {
      setProjectLoading(false);
    }
  }, [user?.id]);

  const fetchProjects = useCallback(async () => {
    if (!user) {
      setProjects([]);
      return;
    }

    setProjectsLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) {
        setProjects([]);
        return;
      }
      setProjects(mapProjectRows(data));
    } finally {
      setProjectsLoading(false);
    }
  }, [user]);

  const requireAuth = useCallback(() => {
    if (user) return true;
    router.push(`/login?next=${encodeURIComponent(currentPathWithQuery())}`);
    return false;
  }, [router, user]);

  const openProject = useCallback(
    (slug: string) => {
      if (!slug) return;
      router.replace(resolveProjectRedirectPath(slug));
    },
    [router]
  );

  const clearProject = useCallback(() => {
    router.replace("/");
  }, [router]);

  const startWithDescription = useCallback(
    async (answers: Record<string, string | string[] | number>) => {
      if (!requireAuth()) return;

      setCreatingProject(true);
      try {
        const result = await startGenerationViaHttp(answers);
        router.replace(resolveProjectRedirectPath(result.share_slug));
      } catch (error) {
        if (isQuotaExceededError(error)) {
          toast.error("Quota reached, set your own AI key to keep using.", { position: "bottom-right" });
        } else {
          toast.error(error instanceof Error ? error.message : "Failed to start generation");
        }
      } finally {
        setCreatingProject(false);
      }
    },
    [requireAuth, router]
  );

  const panels = useWorkspacePanels({ fetchProjects, requireAuth });
  const { rightPanelOpen, rightPanelTab, openMyDesigns, openTemplates, openOutput, closeRightPanel } = panels;

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);

  useEffect(() => {
    if (
      !shouldRedirectUnauthenticatedRootToLogin({
        authLoading,
        hasUser: Boolean(user),
        projectSlug,
      })
    ) {
      return;
    }

    router.replace(`/login?next=${encodeURIComponent(currentPathWithQuery())}`);
  }, [authLoading, projectSlug, router, user]);

  useEffect(() => {
    if (!projectSlug) {
      setCurrentProject(null);
      setProjectNotFound(false);
      setProjectLoading(false);
      return;
    }
    void loadProjectBySlug(projectSlug);
  }, [loadProjectBySlug, projectSlug]);

  useEffect(() => {
    if (!user || projectSlug || rootProjectResolveInFlightRef.current) return;

    rootProjectResolveInFlightRef.current = true;
    setProjectLoading(true);
    let cancelled = false;

    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("projects")
          .select("id, share_slug")
          .eq("user_id", user.id)
          .order("last_opened_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (data?.share_slug) {
          if (!cancelled) {
            router.replace(resolveProjectRedirectPath(data.share_slug));
          }
          return;
        }

        const created = await createProject("My First Project");
        const templateSlug = process.env.NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG;
        if (templateSlug) {
          try {
            const { fetchTemplateDetail } = await import("@/lib/templates");
            const template = await fetchTemplateDetail(templateSlug);
            await saveSnapshot(created.project_id, template.nodes, template.edges);
          } catch {
            // Intentionally ignored: users should still get a new workspace even if template bootstrap fails.
          }
        }

        await supabase
          .from("projects")
          .update({ last_opened_at: new Date().toISOString() })
          .eq("id", created.project_id);

        if (!cancelled) {
          router.replace(resolveProjectRedirectPath(created.share_slug));
        }
      } catch (error) {
        if (!cancelled) {
          setProjectLoading(false);
          console.error("Failed to resolve default workspace project", error);
        }
      } finally {
        rootProjectResolveInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      rootProjectResolveInFlightRef.current = false;
    };
  }, [projectSlug, router, user]);

  useEffect(() => {
    if (!defaultTemplateFetchActiveRef.current) return;
    if (nodes.length > 0 || edges.length > 0) {
      canvasBecameNonEmptyRef.current = true;
    }
  }, [edges.length, nodes.length]);

  useEffect(() => {
    if (user) return;
    if (projectSlug || currentProject) return;

    const templateSlug = process.env.NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG;
    if (!templateSlug) {
      console.warn("NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG not set — landing on / shows empty canvas");
      return;
    }

    reset();

    let cancelled = false;
    canvasBecameNonEmptyRef.current = false;
    defaultTemplateFetchActiveRef.current = true;

    void (async () => {
      try {
        const { fetchTemplateDetail } = await import("@/lib/templates");
        const template = await fetchTemplateDetail(templateSlug);
        if (cancelled || canvasBecameNonEmptyRef.current) return;
        defaultTemplateFetchActiveRef.current = false;
        loadTemplateSnapshot(template);
      } catch {
        // Intentionally ignored: landing page should stay usable even if template bootstrap fails.
      } finally {
        defaultTemplateFetchActiveRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      defaultTemplateFetchActiveRef.current = false;
    };
  }, [currentProject, loadTemplateSnapshot, projectSlug, reset, user]);

  const projectSummaries = useMemo(() => projects.map(toProjectSummary), [projects]);

  return {
    user,
    isOwner,
    requireAuth,
    startWithDescription,
    creatingProject,

    currentProject,
    projectLoading,
    projectNotFound,

    pipeline,

    rightPanelOpen,
    rightPanelTab,
    openMyDesigns,
    openTemplates,
    openOutput,
    closeRightPanel,

    projects,
    projectSummaries,
    projectsLoading,
    fetchProjects,
    setProjects,
    openProject,
    clearProject,

    remainingGenerations,
    generationsLimit,
    hasApiKey,
    quotaLoading,
  };
}
