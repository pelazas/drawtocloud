"use client";

import { useState, useEffect, useRef } from "react";
import OptionButton from "./OptionButton";
import MultiSelectOptions from "./MultiSelectOptions";

interface Question {
  id: string;
  prompt: string;
  subtitle?: string;
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

const SUBTITLES: Record<string, string> = {
  app_name: "Used to name your Terraform resources and tags.",
  app_type: "This helps us choose the right services for your stack.",
  stage: "We'll tune resource sizing and redundancy to match your stage.",
  team_size: "Helps us recommend the right operational complexity.",
};

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
    const handler = (e: KeyboardEvent) => {
      if (!visible) return;
      if (question.type === "single_select" && question.options) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= question.options.length) handleSingleSelect(question.options[num - 1]);
      }
      if (e.key === "Enter") {
        if (question.type === "free_text" && freeText.trim()) onAnswer(question.id, freeText.trim());
        if (question.type === "multi_select" && selectedOptions.length > 0) onAnswer(question.id, selectedOptions);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, question, freeText, selectedOptions, onAnswer]);

  function handleSingleSelect(option: string) {
    if (question.allow_custom && option.includes("Other")) setShowCustom(true);
    else onAnswer(question.id, option);
  }

  const subtitle = question.subtitle ?? SUBTITLES[question.id];

  return (
    <div
      className={`w-full transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-white text-center mb-2">
        {question.prompt}
      </h2>
      {subtitle && <p className="text-sm text-gray-500 text-center mb-10">{subtitle}</p>}

      {question.type === "single_select" && question.options && (
        <div className="flex flex-col gap-2">
          {question.options.map((option, i) => (
            <OptionButton
              key={option}
              label={option}
              index={i}
              selected={currentAnswer === option}
              onClick={() => handleSingleSelect(option)}
            />
          ))}
          {showCustom && (
            <div className="mt-2 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && customInput.trim() && onAnswer(question.id, customInput.trim())}
                placeholder="Describe your use case..."
                className="flex-1 px-[18px] py-[14px] rounded-[10px] bg-[rgb(15_15_20)] border border-[rgb(40_40_50)] text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-[15px] transition-colors"
              />
              <button
                onClick={() => customInput.trim() && onAnswer(question.id, customInput.trim())}
                disabled={!customInput.trim()}
                className="px-4 py-2 rounded-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors text-sm"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {question.type === "multi_select" && question.options && (
        <MultiSelectOptions
          options={question.options}
          selected={selectedOptions}
          onToggle={(o) =>
            setSelectedOptions((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]))
          }
          onConfirm={() => onAnswer(question.id, selectedOptions)}
        />
      )}

      {question.type === "free_text" && (
        <div className="flex gap-2">
          <input
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && freeText.trim() && onAnswer(question.id, freeText.trim())}
            placeholder="Type your answer..."
            className="flex-1 px-[18px] py-[14px] rounded-[10px] bg-[rgb(15_15_20)] border border-[rgb(40_40_50)] text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-[15px] transition-colors"
          />
          <button
            onClick={() => freeText.trim() && onAnswer(question.id, freeText.trim())}
            disabled={!freeText.trim()}
            className="px-6 py-[14px] rounded-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors text-sm"
          >
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}
