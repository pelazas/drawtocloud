"use client";

export default function AgentStepMiniHistory({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  return (
    <ul className="mt-1.5 space-y-0.5">
      {items.map((item, index) => (
        <li
          key={`${item}-${index}`}
          className="flex items-start gap-1.5 text-[11px] text-gray-600"
        >
          <span className="mt-1 w-1 h-1 rounded-full bg-gray-700 flex-shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
