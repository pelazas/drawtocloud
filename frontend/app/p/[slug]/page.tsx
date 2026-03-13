import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { mapProjectRow } from "@/lib/projects";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ProjectBySlugClient from "./project-by-slug-client";

type PageProps = {
  params: { slug?: string | string[] };
};

function normalizeSlug(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" && first.trim() ? first : null;
  }
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

async function getProjectBySlug(slug: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("share_slug", slug)
    .single();

  if (error || !data) {
    return null;
  }

  return mapProjectRow(data);
}

function buildProjectUrl(slug: string): string {
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  if (appDomain && appDomain.trim()) {
    const host = appDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}/p/${slug}`;
  }

  return `https://app.drawtocloud.com/p/${slug}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const slug = normalizeSlug(params.slug);
  if (!slug) {
    return {
      title: "Project not found | DrawToCloud",
      description: "The requested shared project could not be found.",
    };
  }

  const project = await getProjectBySlug(slug);
  if (!project) {
    return {
      title: "Project not found | DrawToCloud",
      description: "The requested shared project could not be found.",
    };
  }

  const costPart =
    typeof project.costEstimate?.monthly_total === "number"
      ? ` Estimated cost: $${project.costEstimate.monthly_total.toFixed(2)}/mo.`
      : "";
  const description = `${project.title} architecture diagram with ${project.nodes.length} services.${costPart}`;
  const url = buildProjectUrl(slug);

  return {
    title: `${project.title} | DrawToCloud`,
    description,
    openGraph: {
      title: `${project.title} | DrawToCloud`,
      description,
      url,
      type: "article",
      siteName: "DrawToCloud",
    },
    twitter: {
      card: "summary_large_image",
      title: `${project.title} | DrawToCloud`,
      description,
    },
    alternates: {
      canonical: url,
    },
  };
}

export default async function ProjectBySlugPage({ params }: PageProps) {
  const slug = normalizeSlug(params.slug);
  if (!slug) {
    notFound();
  }

  const project = await getProjectBySlug(slug);
  if (!project) {
    notFound();
  }

  return <ProjectBySlugClient slug={slug} initialProject={project} />;
}
