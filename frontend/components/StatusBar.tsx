"use client";

interface Props {
  message: string | null;
}

export default function StatusBar({ message }: Props) {
  if (!message) return null;
  const isDone = message.startsWith("Architecture ready");
  return (
    <div
      className={`px-4 py-2 text-sm text-center transition-colors ${
        isDone ? "bg-green-950 text-green-400" : "bg-gray-900 text-gray-400"
      }`}
    >
      {message}
    </div>
  );
}
