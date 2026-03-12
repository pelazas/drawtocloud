interface Props {
  total: number;
  current: number;
  loadingMore: boolean;
}

export default function ProgressBar({ total, current, loadingMore }: Props) {
  const pct = total > 0 ? (current / total) * 100 : 0;

  return (
    <>
      {/* Thin progress line at very top of viewport */}
      <div className="fixed top-0 left-0 right-0 h-[2px] bg-gray-900 z-50">
        <div
          className="h-full bg-blue-500 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Counter label */}
      <p className="text-xs text-gray-600 text-center mb-6 tracking-widest uppercase font-mono">
        {loadingMore ? "Tailoring questions…" : `Question ${current + 1} of ${total}`}
      </p>
    </>
  );
}
