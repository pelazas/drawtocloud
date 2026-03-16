"use client";

import { Key, Trash2, X } from "lucide-react";
import { useApiKeyModal } from "./useApiKeyModal";

type Props = ReturnType<typeof useApiKeyModal>;

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai", label: "OpenAI" },
] as const;

export default function ApiKeyModal({
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
  close,
  save,
  remove,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-white">AI Provider Settings</h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-gray-400 transition-colors hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
        ) : (
          <>
            {existing?.has_key && (
              <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3">
                <p className="text-sm text-green-200">
                  Key configured: <span className="font-medium">{existing.provider}</span>
                  {existing.model && <span className="text-green-300"> ({existing.model})</span>}
                </p>
                <button
                  type="button"
                  onClick={remove}
                  disabled={deleting}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-red-300 transition-colors hover:text-red-200"
                >
                  <Trash2 size={12} />
                  {deleting ? "Removing..." : "Remove key"}
                </button>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm text-gray-400">Provider</label>
                <div className="flex gap-2">
                  {PROVIDERS.map((entry) => (
                    <button
                      key={entry.value}
                      type="button"
                      onClick={() => setProvider(entry.value)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        provider === entry.value
                          ? "border-blue-500 bg-blue-500/10 text-blue-200"
                          : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
                      }`}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm text-gray-400">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={existing?.has_key ? "Enter new key to replace" : "sk-..."}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 transition-colors focus:border-blue-500 focus:outline-none"
                />
              </div>

              {provider === "openrouter" && (
                <div>
                  <label className="mb-1.5 block text-sm text-gray-400">Model</label>
                  <input
                    type="text"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="e.g. qwen/qwen3.5-9b"
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 transition-colors focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex items-center justify-between pt-2">
                <p className="max-w-[60%] text-xs text-gray-500">
                  Your key is encrypted and stored securely. It is never logged or shared.
                </p>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !apiKey.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Key"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
