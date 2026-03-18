"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { cloneTemplate, fetchTemplates, TemplateSummary } from "@/lib/templates";

type Props = {
  open: boolean;
  onClose: () => void;
  onCustom: () => void;
  onTemplateCloned: (shareSlug: string) => void;
};

type ViewMode = "choices" | "templates";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Something went wrong. Please try again.";
}

export default function NewGenerationDialog({ open, onClose, onCustom, onTemplateCloned }: Props) {
  const [mode, setMode] = useState<ViewMode>("choices");
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [cloningSlug, setCloningSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setMode("choices");
      setError(null);
      setTemplatesLoading(false);
      setCloningSlug(null);
    }
  }, [open]);

  async function handleShowTemplates() {
    setMode("templates");
    setError(null);
    if (templates.length > 0) return;

    setTemplatesLoading(true);
    try {
      setTemplates(await fetchTemplates());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function handleClone(templateSlug: string) {
    setError(null);
    setCloningSlug(templateSlug);
    try {
      const result = await cloneTemplate(templateSlug);
      onTemplateCloned(result.share_slug);
    } catch (err) {
      setError(errorMessage(err));
      setCloningSlug(null);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !cloningSlug) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
          onEscapeKeyDown={(e) => { if (cloningSlug) e.preventDefault(); }}
          onInteractOutside={(e) => { if (cloningSlug) e.preventDefault(); }}
        >
          <Dialog.Title className="text-lg font-semibold text-white">Start New Generation</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-400">
            Choose how you want to begin your next architecture project.
          </Dialog.Description>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handleShowTemplates}
              disabled={templatesLoading || cloningSlug !== null}
              className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-4 text-left transition-colors hover:border-gray-600 hover:bg-gray-700 disabled:opacity-50"
            >
              <p className="font-medium text-white">Start from template</p>
              <p className="mt-1 text-sm text-gray-400">Pick a ready architecture and customize it in chat.</p>
            </button>
            <button
              type="button"
              onClick={onCustom}
              disabled={cloningSlug !== null}
              className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-4 text-left transition-colors hover:border-blue-500/70 hover:bg-blue-500/15 disabled:opacity-50"
            >
              <p className="font-medium text-blue-200">Custom</p>
              <p className="mt-1 text-sm text-blue-100/80">Start from scratch with the questionnaire.</p>
            </button>
          </div>

          {mode === "templates" && (
            <div className="mt-5 border-t border-gray-800 pt-5">
              {templatesLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Loader2 size={14} className="animate-spin" />
                  Loading templates...
                </div>
              ) : templates.length === 0 ? (
                <p className="text-sm text-gray-400">No templates are available yet.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {templates.map((template) => {
                    const isCloning = cloningSlug === template.share_slug;
                    return (
                      <button
                        key={template.share_slug}
                        type="button"
                        onClick={() => { void handleClone(template.share_slug); }}
                        disabled={cloningSlug !== null}
                        className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800 text-left transition-colors hover:border-blue-500/60 disabled:opacity-70"
                      >
                        <div className="relative h-[120px] w-full bg-gray-900">
                          {template.thumbnail_url ? (
                            <Image src={template.thumbnail_url} alt={template.title} fill className="object-cover" sizes="(max-width: 1024px) 50vw, 33vw" />
                          ) : null}
                          {isCloning && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
                              <Loader2 size={14} className="mr-2 animate-spin" />
                              Cloning...
                            </div>
                          )}
                        </div>
                        <div className="px-4 py-3">
                          <p className="text-sm font-medium text-white">{template.title}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
