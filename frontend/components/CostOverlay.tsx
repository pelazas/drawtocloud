type CostOverlayProps = {
  monthlyTotal: number;
};

export default function CostOverlay({ monthlyTotal }: CostOverlayProps) {
  if (monthlyTotal <= 0) return null;

  return (
    <div className="absolute top-3 right-3 z-10 rounded-xl border border-white/5 bg-black/30 px-3 py-1.5 text-sm font-medium text-green-400 backdrop-blur-md">
      ${monthlyTotal.toFixed(0)}/mo
    </div>
  );
}
