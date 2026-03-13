"use client";

import UserMenu from "@/components/UserMenu";

interface Props {
  message: string | null;
}

export default function TopBar({ message }: Props) {
  const isDone = message?.startsWith("Architecture ready") ?? false;

  return (
    <div className="border-b border-gray-700 bg-gray-900">
      <div className="px-4 py-2 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-white">DrawToCloud</h1>
          <p className="text-xs text-gray-500">Describe your infrastructure</p>
        </div>
        <UserMenu />
      </div>

      {message && (
        <div className={`px-4 py-2 text-sm text-center ${isDone ? "bg-green-950 text-green-400" : "bg-gray-900 text-gray-400"}`}>
          {message}
        </div>
      )}
    </div>
  );
}
