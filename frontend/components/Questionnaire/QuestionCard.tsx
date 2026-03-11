"use client";

import { useState, useEffect, useRef } from "react";

interface Question {
  id: string;
  prompt: string;
  type: "single_select" | "multi_select" | "free_text";
  options: string[] | null;
  allow_custom: boolean;
}

interface Props {
  question: Question;
  currentAnswer: string | string[] | undefined;
  onAnswer: (id: string, value: string | string[]) => void;
  visible: boolean;
}

export default function QuestionCard({ question, currentAnswer, onAnswer, visible }: Props) {
  const [customInput, setCustomInput] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCustomInput("");
    setShowCustom(false);
    setSelectedOptions([]);
    setFreeText("");
  }, [question.id]);

  useEffect(() => {
    if (showCustom) inputRef.current?.focus();
  }, [showCustom]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return;
      if (question.type === "single_select" && question.options) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= question.options.length) {
          const option = question.options[num - 1];
          handleSingleSelect(option);
        }
      }
      if (e.key === "Enter") {
        if (question.type === "free_text" && freeText.trim()) {
          onAnswer(question.id, freeText.trim());
        }
        if (question.type === "multi_select" && selectedOptions.length > 0) {
          onAnswer(question.id, selectedOptions);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, question, freeText, selectedOptions, onAnswer]);

  function handleSingleSelect(option: string) {
    if (question.allow_custom && option.includes("Other")) {
      setShowCustom(true);
    } else {
      onAnswer(question.id, option);
    }
  }

  function handleCustomSubmit() {
    const val = customInput.trim();
    if (val) onAnswer(question.id, val);
  }

  function toggleMultiOption(option: string) {
    setSelectedOptions((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
    );
  }

  return (
    <div
      className={`w-full max-w-2xl transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <h2 className="text-2xl font-semibold text-white mb-8 text-center">{question.prompt}</h2>

      {question.type === "single_select" && question.options && (
        <div>
          <div className="grid grid-cols-2 gap-3">
            {question.options.map((option, i) => (
              <button
                key={option}
                onClick={() => handleSingleSelect(option)}
                className="flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-700 bg-gray-900 hover:bg-gray-800 hover:border-blue-500 transition-all text-left text-gray-200 text-sm"
              >
                <span className="text-gray-500 text-xs w-4">{i + 1}</span>
                {option}
              </button>
            ))}
          </div>
          {showCustom && (
            <div className="mt-4 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
                placeholder="Describe your use case..."
                className="flex-1 px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleCustomSubmit}
                disabled={!customInput.trim()}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
              >
                Next &rarr;
              </button>
            </div>
          )}
        </div>
      )}

      {question.type === "multi_select" && question.options && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {question.options.map((option) => (
              <label
                key={option}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all ${
                  selectedOptions.includes(option)
                    ? "border-blue-500 bg-blue-950 text-white"
                    : "border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-200"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedOptions.includes(option)}
                  onChange={() => toggleMultiOption(option)}
                  className="accent-blue-500"
                />
                <span className="text-sm">{option}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => onAnswer(question.id, selectedOptions)}
              disabled={selectedOptions.length === 0}
              className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}

      {question.type === "free_text" && (
        <div className="flex gap-2">
          <input
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && freeText.trim() && onAnswer(question.id, freeText.trim())}
            placeholder="Type your answer..."
            className="flex-1 px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
          />
          <button
            onClick={() => freeText.trim() && onAnswer(question.id, freeText.trim())}
            disabled={!freeText.trim()}
            className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          >
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
