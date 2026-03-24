"use client";

import { type Dispatch, type SetStateAction, useRef, useState } from "react";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { deleteProject, type PersistedProject } from "@/lib/projects";

type UseProjectDeleteParams = {
  projects: PersistedProject[];
  setProjects: Dispatch<SetStateAction<PersistedProject[]>>;
};

type UseProjectDelete = {
  pendingDeleteId: string | null;
  isDeleting: boolean;
  handleDeleteClick: (id: string) => void;
  confirmDelete: () => Promise<void>;
  cancelDelete: () => void;
};

export function useProjectDelete({
  projects,
  setProjects,
}: UseProjectDeleteParams): UseProjectDelete {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const pendingDeleteIndexRef = useRef<number | null>(null);
  const pendingSnapshotRef = useRef<PersistedProject | null>(null);

  function handleDeleteClick(id: string) {
    if (isDeleting) return;
    const index = projects.findIndex((project) => project.id === id);
    if (index === -1) return;
    pendingDeleteIndexRef.current = index;
    pendingSnapshotRef.current = projects[index];
    setPendingDeleteId(id);
  }

  async function confirmDelete() {
    if (!pendingDeleteId || isDeleting) return;

    const projectId = pendingDeleteId;
    const snapshot = pendingSnapshotRef.current;
    const index = pendingDeleteIndexRef.current ?? 0;

    setIsDeleting(true);
    setProjects((prev) => prev.filter((project) => project.id !== projectId));

    try {
      const supabase = getSupabaseBrowserClient();
      await deleteProject(supabase, projectId);
      toast.success("Project deleted");
    } catch {
      if (snapshot !== null) {
        setProjects((prev) => [...prev.slice(0, index), snapshot, ...prev.slice(index)]);
      }
      toast.error("Failed to delete project. Please try again.");
    } finally {
      setIsDeleting(false);
      setPendingDeleteId(null);
      pendingDeleteIndexRef.current = null;
      pendingSnapshotRef.current = null;
    }
  }

  function cancelDelete() {
    if (isDeleting) return;
    setPendingDeleteId(null);
    pendingDeleteIndexRef.current = null;
    pendingSnapshotRef.current = null;
  }

  return { pendingDeleteId, isDeleting, handleDeleteClick, confirmDelete, cancelDelete };
}
