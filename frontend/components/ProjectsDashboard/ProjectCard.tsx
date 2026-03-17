"use client";

import Image from "next/image";
import { CalendarDays, DollarSign, FolderKanban, Network, Trash2 } from "lucide-react";
import type { ProjectSummary } from "@/lib/projects";

type Props = {
  project: ProjectSummary;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

function formatCreatedDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatMonthlyCost(value: number | null): string {
  if (value === null) return "Cost not available";
  return `$${value.toFixed(2)}/mo`;
}

export default function ProjectCard({ project, onOpen, onDelete }: Props) {
  return (
    <div className="group relative rounded-2xl border border-gray-800 bg-gray-900/70 transition-colors hover:border-blue-500/40 hover:bg-gray-900">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
        className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-gray-500 opacity-0 transition-opacity hover:bg-gray-700 hover:text-red-400 group-hover:opacity-100"
        aria-label={`Delete ${project.title}`}
        title="Delete project"
      >
        <Trash2 size={14} />
      </button>

      <button
        type="button"
        onClick={() => onOpen(project.id)}
        className="w-full"
      >
        {project.thumbnailUrl ? (
          <div className="relative h-[120px] w-full overflow-hidden rounded-t-2xl">
            <Image
              src={project.thumbnailUrl}
              alt={project.title}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          </div>
        ) : (
          <div className="flex h-[120px] items-center justify-center rounded-t-2xl bg-gray-800/50">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-300">
              <FolderKanban size={18} />
            </div>
          </div>
        )}
      </button>

      <button
        type="button"
        onClick={() => onOpen(project.id)}
        className="w-full text-left p-4"
      >
        <h3 className="min-h-[2.5rem] text-base font-semibold text-white">{project.title}</h3>

        <div className="mt-4 space-y-2 text-xs text-gray-400">
          <p className="flex items-center gap-2">
            <CalendarDays size={13} />
            {formatCreatedDate(project.createdAt)}
          </p>
          <p className="flex items-center gap-2">
            <DollarSign size={13} />
            {formatMonthlyCost(project.monthlyCost)}
          </p>
          <p className="flex items-center gap-2">
            <Network size={13} />
            {project.nodeCount} services
          </p>
        </div>
      </button>
    </div>
  );
}
