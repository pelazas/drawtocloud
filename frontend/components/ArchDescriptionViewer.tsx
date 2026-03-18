"use client";
import { useState } from "react";
import { Copy, Check, Download } from "lucide-react";

export type ArchDescription = {
  overview: string;
  key_components: string;
  tradeoffs: string;
  next_steps: string;
};

type Props = {
  sections: ArchDescription | null;
  isGenerating: boolean;
};

const SECTION_LABELS: { key: keyof ArchDescription; title: string }[] = [
  { key: "overview", title: "Overview" },
  { key: "key_components", title: "Key Components" },
  { key: "tradeoffs", title: "Tradeoffs" },
  { key: "next_steps", title: "Next Steps" },
];

function toMarkdown(sections: ArchDescription): string {
  return SECTION_LABELS.map(({ key, title }) => `## ${title}\n${sections[key]}`).join("\n\n");
}

function Skeleton() {
  return (
    <div className="px-4 py-4 flex flex-col gap-5 animate-pulse">
      {SECTION_LABELS.map(({ key }) => (
        <div key={key}>
          <div className="h-3 w-24 bg-gray-700 rounded mb-2" />
          <div className="h-3 bg-gray-800 rounded mb-1" />
          <div className="h-3 bg-gray-800 rounded mb-1 w-5/6" />
          <div className="h-3 bg-gray-800 rounded w-4/6" />
        </div>
      ))}
    </div>
  );
}

export default function ArchDescriptionViewer({ sections, isGenerating }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!sections) return;
    try {
      await navigator.clipboard.writeText(toMarkdown(sections));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently ignore clipboard errors
    }
  }

  function handleDownload() {
    if (!sections) return;
    const blob = new Blob([toMarkdown(sections)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "architecture.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isGenerating && !sections) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex gap-2 px-3 py-2 border-b border-gray-800 flex-shrink-0" />
        <div className="flex-1 overflow-y-auto">
          <Skeleton />
        </div>
      </div>
    );
  }

  if (!sections) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Generate an architecture to see the description
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Action bar */}
      <div className="flex justify-end gap-2 px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <button
          onClick={handleCopy}
          title={copied ? "Copied!" : "Copy as Markdown"}
          className={`flex items-center gap-1 text-xs transition-colors ${
            copied ? "text-green-400" : "text-gray-400 hover:text-white"
          }`}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={handleDownload}
          title="Download architecture.md"
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <Download size={16} />
          Download .md
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {SECTION_LABELS.map(({ key, title }, i) => (
          <div key={key} className={i > 0 ? "mt-5" : ""}>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
              {title}
            </p>
            <p className="text-sm text-gray-100 leading-relaxed">{sections[key]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
