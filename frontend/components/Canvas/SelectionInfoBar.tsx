"use client";

import React from "react";

interface SelectionInfoBarProps {
  count: number;
  onDelete: () => void;
}

export default function SelectionInfoBar({ count, onDelete }: SelectionInfoBarProps) {
  if (count === 0) return null;

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-xl border border-white/5 shadow-lg shadow-black/30 transition-opacity duration-200"
      style={{ background: "rgba(0,0,0,0.3)", backdropFilter: "blur(12px)" }}
    >
      <span className="text-sm text-gray-200">
        {count} {count === 1 ? "item" : "items"} selected
      </span>
      <button
        onClick={onDelete}
        className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors"
        aria-label="Delete selected nodes"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 0 1 1.334-1.334h2.666a1.333 1.333 0 0 1 1.334 1.334V4m2 0v9.333a1.333 1.333 0 0 1-1.334 1.334H4.667a1.333 1.333 0 0 1-1.334-1.334V4h9.334Z" />
        </svg>
      </button>
    </div>
  );
}
