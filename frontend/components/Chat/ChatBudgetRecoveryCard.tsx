"use client";

interface ChatBudgetRecoveryCardProps {
  onBudgetRecoveryAction?: (action: "accept" | "retry") => void;
  budgetRecoveryDisabled?: boolean;
  disabled?: boolean;
  isTyping?: boolean;
  readOnly?: boolean;
}

export default function ChatBudgetRecoveryCard({
  onBudgetRecoveryAction,
  budgetRecoveryDisabled,
  disabled,
  isTyping,
  readOnly,
}: ChatBudgetRecoveryCardProps) {
  const isActionDisabled = disabled || isTyping || readOnly || budgetRecoveryDisabled;

  return (
    <div className="flex justify-start gap-2 pl-1 mt-1">
      <button
        type="button"
        onClick={() => onBudgetRecoveryAction?.("accept")}
        disabled={isActionDisabled}
        className="px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-800 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60 text-xs text-gray-100 transition-colors"
      >
        Accept
      </button>
      <button
        type="button"
        onClick={() => onBudgetRecoveryAction?.("retry")}
        disabled={isActionDisabled}
        className="px-3 py-1.5 rounded-lg border border-blue-600 bg-blue-600 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 text-xs text-white transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
