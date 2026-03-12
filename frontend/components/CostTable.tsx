"use client";

export type CostLineItem = {
  service: string;
  resource_type: string;
  monthly_cost: number;
};

export type CostEstimate = {
  monthly_total: number;
  currency: string;
  line_items: CostLineItem[];
  generated_by: string;
  note?: string;
};

type Props = {
  estimate: CostEstimate | null;
  isGenerating: boolean;
};

export default function CostTable({ estimate, isGenerating }: Props) {
  if (!estimate) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        {isGenerating ? (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Calculating cost estimate...
          </div>
        ) : (
          "Generate an architecture to see cost estimate"
        )}
      </div>
    );
  }

  const isInfracost = estimate.generated_by === "infracost";
  const top6 = estimate.line_items.slice(0, 6);
  const maxCost = top6[0]?.monthly_cost ?? 1;

  return (
    <div className="flex flex-col gap-4 p-4 overflow-auto">
      {/* Total card */}
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="text-3xl font-bold text-white font-mono">
          ${estimate.monthly_total.toFixed(2)}
          <span className="text-base font-normal text-gray-400 ml-1">/mo</span>
        </div>
        <div className="mt-1">
          {isInfracost ? (
            <span className="text-xs text-green-400">✓ Powered by Infracost</span>
          ) : (
            <span className="text-xs text-yellow-400">⚠ Claude estimate</span>
          )}
          {estimate.note && (
            <span className="text-xs text-gray-500 ml-2">{estimate.note}</span>
          )}
        </div>
      </div>

      {/* Bar chart */}
      {top6.length > 0 && (
        <div className="flex flex-col gap-2">
          {top6.map((item) => (
            <div key={item.service} className="flex items-center gap-2 text-xs">
              <div className="w-32 text-gray-400 truncate">{item.service}</div>
              <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-700"
                  style={{ width: `${(item.monthly_cost / maxCost) * 100}%` }}
                />
              </div>
              <div className="w-16 text-right text-gray-300 font-mono">
                ${item.monthly_cost.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Line items table */}
      {estimate.line_items.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left pb-2">Service</th>
              <th className="text-left pb-2 text-gray-500">Type</th>
              <th className="text-right pb-2">Monthly</th>
            </tr>
          </thead>
          <tbody>
            {estimate.line_items.map((item, i) => (
              <tr key={i} className="border-b border-gray-800">
                <td className="py-2 text-gray-300">{item.service}</td>
                <td className="py-2 text-gray-500">{item.resource_type}</td>
                <td className="py-2 text-right text-gray-300 font-mono">
                  ${item.monthly_cost.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
