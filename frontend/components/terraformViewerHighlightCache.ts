import type { TerraformFile } from "./TerraformViewer";

export type HighlightCacheEntry = {
  content: string;
  html: string;
};

export type HighlightCache = Record<string, HighlightCacheEntry>;
export type HighlightFailures = Record<string, string>;

export function isCurrentFileVersion(files: TerraformFile[], file: TerraformFile): boolean {
  return files.some((entry) => entry.filename === file.filename && entry.content === file.content);
}

export function syncHighlightCache(cache: HighlightCache, files: TerraformFile[]): HighlightCache {
  const activeContents = new Map(files.map((file) => [file.filename, file.content]));
  const next: HighlightCache = {};
  for (const [filename, entry] of Object.entries(cache)) {
    if (activeContents.get(filename) === entry.content) next[filename] = entry;
  }
  return next;
}

export function syncHighlightFailures(failures: HighlightFailures, files: TerraformFile[]): HighlightFailures {
  const activeContents = new Map(files.map((file) => [file.filename, file.content]));
  const next: HighlightFailures = {};
  for (const [filename, content] of Object.entries(failures)) {
    if (activeContents.get(filename) === content) next[filename] = content;
  }
  return next;
}

export function getPendingHighlightFile(
  files: TerraformFile[],
  cache: HighlightCache,
  failures: HighlightFailures
): TerraformFile | null {
  const pending = files.find((file) => {
    const cached = cache[file.filename];
    return !cached || cached.content !== file.content;
  });
  if (!pending) return null;
  if (failures[pending.filename] === pending.content) return null;
  return pending;
}

export function getHighlightedHtml(file: TerraformFile | null, cache: HighlightCache): string | null {
  if (!file) return null;
  const entry = cache[file.filename];
  if (!entry || entry.content !== file.content) return null;
  return entry.html;
}
