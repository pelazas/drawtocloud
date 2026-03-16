import { useCallback, useState } from "react";
import { deleteLlmKey, getLlmKeyStatus, saveLlmKey, type LlmKeyStatus } from "@/lib/llmKeys";

export type ApiKeyModalState = {
  isOpen: boolean;
  provider: string;
  apiKey: string;
  model: string;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  existing: LlmKeyStatus | null;
  loading: boolean;
};

export function useApiKeyModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<LlmKeyStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const status = await getLlmKeyStatus();
      setExisting(status);
      if (status.has_key && status.provider) {
        setProvider(status.provider);
      }
      if (status.model) {
        setModel(status.model);
      }
      return status;
    } catch {
      setExisting(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const open = useCallback(async () => {
    setIsOpen(true);
    setError(null);
    setApiKey("");
    await refreshStatus();
  }, [refreshStatus]);

  const close = useCallback(() => {
    setIsOpen(false);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (!apiKey.trim()) {
      setError("API key is required.");
      return;
    }

    if (provider === "openrouter" && !model.trim()) {
      setError("Model is required for OpenRouter (e.g. qwen/qwen3.5-9b).");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await saveLlmKey(provider, apiKey.trim(), provider === "openrouter" ? model.trim() : null);
      await refreshStatus();
      setApiKey("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [apiKey, model, provider, refreshStatus]);

  const remove = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteLlmKey();
      setExisting(null);
      setProvider("anthropic");
      setModel("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }, []);

  return {
    isOpen,
    provider,
    apiKey,
    model,
    saving,
    deleting,
    error,
    existing,
    loading,
    setProvider,
    setApiKey,
    setModel,
    refreshStatus,
    open,
    close,
    save,
    remove,
  };
}
