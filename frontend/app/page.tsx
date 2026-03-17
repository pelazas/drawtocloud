"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ApiKeyModal from "@/components/ApiKeyModal";
import ProjectsDashboard from "@/components/ProjectsDashboard";
import { useApiKeyModal } from "@/components/ApiKeyModal/useApiKeyModal";
import { useAuth } from "@/components/auth/useAuth";
import { fetchUserEntitlements } from "@/lib/entitlements";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { PersistedProject, mapProjectRows, toProjectSummary } from "@/lib/projects";
import { useProjectsDashboard } from "@/components/ProjectsDashboard/useProjectsDashboard";
import { useQuota } from "@/lib/useQuota";

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<PersistedProject[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [entitlementsLoading, setEntitlementsLoading] = useState(true);
  const apiKeyModal = useApiKeyModal();
  const refreshApiKeyStatus = apiKeyModal.refreshStatus;

  const { user } = useAuth();

  const { generationsUsed, generationsLimit, quotaLoading, refreshQuota } = useQuota(user);

  const refreshEntitlements = useCallback(async () => {
    if (!user) {
      setIsAdmin(false);
      setEntitlementsLoading(false);
      return;
    }

    setEntitlementsLoading(true);
    const entitlements = await fetchUserEntitlements();
    setIsAdmin(entitlements.isAdmin);
    setEntitlementsLoading(false);
  }, [user]);

  const fetchProjects = useCallback(async (): Promise<PersistedProject[]> => {
    if (!user) {
      setProjects([]);
      return [];
    }

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Failed to load projects:", error);
      setProjects([]);
      return [];
    }

    const mappedProjects = mapProjectRows(data);
    setProjects(mappedProjects);
    return mappedProjects;
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const loadInitialState = async () => {
      setInitialLoading(true);
      await Promise.all([refreshQuota(), refreshEntitlements(), refreshApiKeyStatus()]);
      await fetchProjects();

      if (cancelled) return;
      setInitialLoading(false);
    };

    void loadInitialState();

    return () => {
      cancelled = true;
    };
  }, [user, refreshQuota, refreshEntitlements, fetchProjects, refreshApiKeyStatus]);

  const remainingGenerations = Math.max(generationsLimit - generationsUsed, 0);
  const effectiveQuotaLoading = quotaLoading || entitlementsLoading;
  const projectSummaries = useMemo(() => projects.map(toProjectSummary), [projects]);

  const { pendingDeleteId, isDeleting, handleDeleteClick, confirmDelete, cancelDelete } =
    useProjectsDashboard({ projects, setProjects });

  function handleOpenProject(projectId: string) {
    const project = projectSummaries.find((entry) => entry.id === projectId);
    if (!project) return;

    if (!project.shareSlug) {
      setOpenError("This project cannot be opened yet because it is missing a share link slug.");
      return;
    }

    setOpenError(null);
    router.push(`/p/${project.shareSlug}`);
  }

  function handleNewGeneration() {
    setOpenError(null);
    router.push("/new");
  }

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-300 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          Loading your projects...
        </div>
      </div>
    );
  }

  return (
    <>
      <ProjectsDashboard
        projects={projectSummaries}
        remainingGenerations={remainingGenerations}
        generationLimit={generationsLimit}
        quotaLoading={effectiveQuotaLoading}
        hasApiKey={apiKeyModal.existing?.has_key ?? false}
        isAdmin={isAdmin}
        onOpenSettings={apiKeyModal.open}
        onOpenProject={handleOpenProject}
        onNewGeneration={handleNewGeneration}
        onDeleteProject={handleDeleteClick}
        pendingDeleteId={pendingDeleteId}
        isDeleting={isDeleting}
        onConfirmDelete={confirmDelete}
        onCancelDelete={cancelDelete}
        navigationError={openError}
      />
      <ApiKeyModal {...apiKeyModal} />
    </>
  );
}
