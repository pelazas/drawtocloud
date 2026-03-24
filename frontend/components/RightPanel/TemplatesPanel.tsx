"use client";

import TemplateCard from "@/components/RightPanel/TemplateCard";
import { useTemplatesPanel } from "@/components/RightPanel/useTemplatesPanel";

type TemplatesPanelProps = {
  onUseTemplate: (slug: string) => void;
};

export default function TemplatesPanel({ onUseTemplate }: TemplatesPanelProps) {
  const { templates, loading, error, reload } = useTemplatesPanel();

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 bg-[linear-gradient(180deg,#0b1020_0%,#0a0f1c_100%)]">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-[196px] rounded-3xl border border-[#21273a] bg-[#151a2c]/75 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center bg-[linear-gradient(180deg,#0b1020_0%,#0a0f1c_100%)]">
        <p className="text-sm text-red-300">Failed to load templates</p>
        <p className="text-xs text-gray-400 mt-1">{error}</p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-3 px-3 py-1 text-xs rounded border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 bg-[linear-gradient(180deg,#0b1020_0%,#0a0f1c_100%)]">
        <p className="text-sm text-gray-400">No templates available</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4 bg-[linear-gradient(180deg,#0b1020_0%,#0a0f1c_100%)]">
      {templates.map((template) => (
        <TemplateCard
          key={template.share_slug}
          template={template}
          onUse={onUseTemplate}
        />
      ))}
    </div>
  );
}
