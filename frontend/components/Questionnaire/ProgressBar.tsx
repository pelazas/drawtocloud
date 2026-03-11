interface Props {
  total: number;
  current: number;
  loadingMore: boolean;
}

export default function ProgressBar({ total, current, loadingMore }: Props) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`w-2 h-2 rounded-full transition-all duration-300 ${
            i < current
              ? "bg-blue-500"
              : i === current
              ? "bg-blue-400 animate-pulse"
              : "bg-gray-600"
          }`}
        />
      ))}
      {loadingMore && (
        <>
          {[0, 1, 2].map((i) => (
            <div
              key={`loading-${i}`}
              className="w-2 h-2 rounded-full bg-gray-600 animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </>
      )}
    </div>
  );
}
