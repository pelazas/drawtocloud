"use client";

import { useCallback, useState } from "react";
import type { RightPanelTab } from "./useWorkspace";

export function useWorkspacePanels({
  fetchProjects,
  requireAuth,
}: {
  fetchProjects: () => Promise<void>;
  requireAuth: () => boolean;
}) {
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("output");

  const openMyDesigns = useCallback(() => {
    if (!requireAuth()) return;
    void fetchProjects();
    setRightPanelTab("designs");
    setRightPanelOpen(true);
  }, [fetchProjects, requireAuth]);

  const openTemplates = useCallback(() => {
    setRightPanelTab("templates");
    setRightPanelOpen(true);
  }, []);

  const openOutput = useCallback(() => {
    setRightPanelTab("output");
    setRightPanelOpen(true);
  }, []);

  const closeRightPanel = useCallback(() => {
    setRightPanelOpen(false);
  }, []);

  return { rightPanelOpen, rightPanelTab, openMyDesigns, openTemplates, openOutput, closeRightPanel };
}
