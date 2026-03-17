"use client";

import React from "react";

interface SelectionInfoBarProps {
  count: number;
}

export default function SelectionInfoBar({ count }: SelectionInfoBarProps) {
  if (count === 0) return null;

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-xl border border-white/5 shadow-lg shadow-black/30 transition-opacity duration-200"
      style={{ background: "rgba(0,0,0,0.3)", backdropFilter: "blur(12px)" }}
    >
      <span className="text-sm text-gray-200">
        {count} {count === 1 ? "item" : "items"} selected
      </span>
    </div>
  );
}
