"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchTemplates, type TemplateSummary } from "@/lib/templates";

type TemplatesPanelState = {
  templates: TemplateSummary[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useTemplatesPanel(): TemplatesPanelState {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTemplates();
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { templates, loading, error, reload };
}
