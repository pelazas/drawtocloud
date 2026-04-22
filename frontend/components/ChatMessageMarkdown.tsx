"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessageMarkdownProps {
  content: string;
}

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
  children?: ReactNode;
};

/* eslint-disable react/no-unknown-property */
const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-3 text-base font-semibold leading-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-3 mt-4 text-sm font-semibold leading-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-3 text-sm font-semibold leading-tight">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-2 text-sm font-semibold leading-tight">{children}</h4>,
  // Use <div> instead of <p> to avoid invalid nesting when markdown contains
  // block-level children (e.g. <pre> inside a paragraph from remark-gfm).
  p: ({ children }) => <div className="mb-3 last:mb-0 leading-relaxed">{children}</div>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ inline, children }: MarkdownCodeProps) => {
    if (inline) {
      return (
        <code className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[0.85em]">
          {children}
        </code>
      );
    }

    const codeContent = String(children).replace(/\n$/, "");
    return (
      <pre className="mb-3 overflow-x-auto rounded-md bg-gray-800 p-3">
        <code className="font-mono text-xs whitespace-pre">{codeContent}</code>
      </pre>
    );
  },
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-800/70">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-gray-600 px-3 py-1.5 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-gray-600 px-3 py-1.5 align-top">{children}</td>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-gray-500 pl-3 italic text-gray-300">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-gray-600" />,
};

export default function ChatMessageMarkdown({ content }: ChatMessageMarkdownProps) {
  return (
    <div className="break-words">
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
