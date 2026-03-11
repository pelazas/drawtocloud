"use client";

import { useEffect, useState } from "react";

interface Props {
  onClick: () => void;
  allAnswers: Record<string, string | string[]>;
}

function summarize(answers: Record<string, string | string[]>): string {
  const parts: string[] = [];
  if (answers.app_type) {
    const t = String(answers.app_type).replace(/^[^\s]+ /, "").split(" or ")[0];
    parts.push(t);
  }
  if (answers.stage) {
    parts.push(String(answers.stage).replace(/^[^\s]+ /, ""));
  }
  if (answers.team_size) {
    const s = String(answers.team_size).replace(/^[^\s]+ /, "");
    parts.push(s.split(" ")[0]);
  }
  return parts.join(" \u00B7 ");
}

export default function GenerateButton({ onClick, allAnswers }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  const summary = summarize(allAnswers);

  return (
    <div
      className={`flex flex-col items-center gap-4 transition-all duration-500 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      {summary && (
        <p className="text-gray-400 text-sm">{summary}</p>
      )}
      <button
        onClick={onClick}
        className="px-8 py-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-lg font-semibold transition-all shadow-lg shadow-blue-900/30"
      >
        Generate Architecture &rarr;
      </button>
    </div>
  );
}
