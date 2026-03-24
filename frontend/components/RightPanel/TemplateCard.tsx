"use client";

import { ArrowRight, Bot, Link2, ShieldCheck, Workflow } from "lucide-react";
import type { TemplateSummary } from "@/lib/templates";

type TemplateCardProps = {
  template: TemplateSummary;
  onUse: (slug: string) => void;
};

function iconForTemplate(title: string) {
  const value = title.toLowerCase();
  if (value.includes("url") || value.includes("shortener")) return Link2;
  if (value.includes("agent") || value.includes("llm")) return Bot;
  if (value.includes("secure") || value.includes("bank") || value.includes("ledger")) return ShieldCheck;
  return Workflow;
}

export default function TemplateCard({ template, onUse }: TemplateCardProps) {
  const Icon = iconForTemplate(template.title);
  return (
    <article className="h-[196px] rounded-3xl border border-[#21273a] bg-[#151a2c]/75 px-5 py-4 hover:border-[#2e3a5d] transition-colors flex flex-col">
      <div className="flex items-center gap-2.5">
        <Icon size={15} className="text-blue-500 shrink-0" />
        <h3 className="text-[19px] font-semibold tracking-[0.01em] text-gray-100 leading-tight" title={template.title}>
          {template.title}
        </h3>
      </div>

      <p className="mt-3 text-[14px] leading-5 text-[#7f8aa7] h-[72px] overflow-hidden">
        {template.description ?? "Production-ready architecture blueprint with resilient and scalable AWS primitives."}
      </p>

      <div className="mt-auto flex justify-end">
        <button
          type="button"
          onClick={() => onUse(template.share_slug)}
          className="inline-flex items-center gap-1 text-[13px] font-semibold uppercase tracking-[0.14em] text-blue-500 hover:text-blue-400 transition-colors"
        >
          Load
          <ArrowRight size={13} />
        </button>
      </div>
    </article>
  );
}
