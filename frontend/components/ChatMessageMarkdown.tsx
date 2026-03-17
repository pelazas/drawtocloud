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

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 text-base font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 text-sm font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ inline, children }: MarkdownCodeProps) => {
    if (inline) {
      return (
        <code className="rounded bg-gray-800 px-1 py-0.5 font-mono text-[0.85em]">
          {children}
        </code>
      );
    }

    const codeContent = String(children).replace(/\n$/, "");
    return (
      <pre className="mb-2 overflow-x-auto rounded-md bg-gray-800 p-3">
        <code className="font-mono text-xs whitespace-pre">{codeContent}</code>
      </pre>
    );
  },
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-800/70">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-gray-600 px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-gray-600 px-2 py-1 align-top">{children}</td>,
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
