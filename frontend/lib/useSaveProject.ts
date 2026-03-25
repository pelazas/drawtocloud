"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Edge, Node } from "reactflow";
import { createProject, saveSnapshot } from "./projectApi";
import { resolveProjectRedirectPath } from "./generationStart";
import type { PersistedProject } from "./projects";

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
};

type SaveSnapshotFn = (projectId: string, nodes: Node[], edges: Edge[]) => Promise<void>;
type CreateProjectFn = (name: string) => Promise<{ project_id: string; share_slug: string }>;
type ResolveRedirectPathFn = (shareSlug: string | null) => string;

export type SaveIntent = "save-owned" | "create-new" | "forbidden";

export function decideSaveIntent(currentProject: Pick<PersistedProject, "id"> | null, isOwner: boolean): SaveIntent {
  if (!currentProject) return "create-new";
  if (isOwner) return "save-owned";
  return "forbidden";
}

export function canStartSave(saving: boolean, inFlight: boolean): boolean {
  return !saving && !inFlight;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

export async function saveOwnedProjectSnapshot({
  projectId,
  nodes,
  edges,
  saveSnapshotFn = saveSnapshot,
  toastApi = toast,
}: {
  projectId: string;
  nodes: Node[];
  edges: Edge[];
  saveSnapshotFn?: SaveSnapshotFn;
  toastApi?: ToastApi;
}): Promise<void> {
  try {
    await saveSnapshotFn(projectId, nodes, edges);
    toastApi.success("Project saved");
  } catch (error) {
    toastApi.error(errorMessage(error, "Failed to save project"));
    throw error;
  }
}

export async function createProjectWithSnapshot({
  name,
  nodes,
  edges,
  createProjectFn = createProject,
  saveSnapshotFn = saveSnapshot,
  resolveRedirectPathFn = resolveProjectRedirectPath,
  replaceRoute,
  toastApi = toast,
}: {
  name: string;
  nodes: Node[];
  edges: Edge[];
  createProjectFn?: CreateProjectFn;
  saveSnapshotFn?: SaveSnapshotFn;
  resolveRedirectPathFn?: ResolveRedirectPathFn;
  replaceRoute: (path: string) => void;
  toastApi?: ToastApi;
}): Promise<void> {
  try {
    const createdProject = await createProjectFn(name);
    await saveSnapshotFn(createdProject.project_id, nodes, edges);
    replaceRoute(resolveRedirectPathFn(createdProject.share_slug));
    toastApi.success("Project saved");
  } catch (error) {
    toastApi.error(errorMessage(error, "Failed to save project"));
    throw error;
  }
}

export function useSaveProject({
  currentProject,
  isOwner,
  nodes,
  edges,
}: {
  currentProject: PersistedProject | null;
  isOwner: boolean;
  nodes: Node[];
  edges: Edge[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const saveInFlightRef = useRef(false);

  const intent = useMemo(() => decideSaveIntent(currentProject, isOwner), [currentProject, isOwner]);
  const canSave = intent !== "forbidden";

  const handleSaveClick = useCallback(async () => {
    if (!canStartSave(saving, saveInFlightRef.current)) {
      return;
    }

    if (intent === "forbidden") {
      return;
    }

    if (intent === "create-new") {
      setShowModal(true);
      return;
    }

    if (!currentProject) {
      return;
    }

    saveInFlightRef.current = true;
    setSaving(true);
    try {
      await saveOwnedProjectSnapshot({
        projectId: currentProject.id,
        nodes,
        edges,
      });
    } catch {
      // Error toast is handled by saveOwnedProjectSnapshot.
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }, [currentProject, edges, intent, nodes, saving]);

  const saveNew = useCallback(
    async (name: string) => {
      if (!canStartSave(saving, saveInFlightRef.current)) {
        return;
      }

      saveInFlightRef.current = true;
      setSaving(true);
      try {
        await createProjectWithSnapshot({
          name,
          nodes,
          edges,
          replaceRoute: (path) => router.replace(path),
        });
      } catch {
        // Error toast is handled by createProjectWithSnapshot.
      } finally {
        saveInFlightRef.current = false;
        setShowModal(false);
        setSaving(false);
      }
    },
    [edges, nodes, router, saving]
  );

  const closeModal = useCallback(() => {
    setShowModal(false);
  }, []);

  return {
    saving,
    showModal,
    canSave,
    handleSaveClick,
    saveNew,
    closeModal,
  };
}
