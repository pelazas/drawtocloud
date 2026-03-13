"use client";

import QuestionCard from "./QuestionCard";
import ProgressBar from "./ProgressBar";
import GenerateButton from "./GenerateButton";
import BrandBar from "./BrandBar";
import { useQuestionnaire } from "./useQuestionnaire";

const BG_STYLE = {
  background: "radial-gradient(ellipse at 50% 0%, rgb(15 23 42) 0%, rgb(2 4 12) 70%)",
};

interface Props {
  onComplete: (answers: Record<string, string | string[]>) => void;
  remainingGenerations: number;
  generationLimit: number;
  quotaLoading: boolean;
  isAdmin?: boolean;
  quotaExhaustedMessage: string;
}

export default function Questionnaire({
  onComplete,
  remainingGenerations,
  generationLimit,
  quotaLoading,
  isAdmin = false,
  quotaExhaustedMessage,
}: Props) {
  const { allQuestions, currentQuestion, currentIndex, answers, visible, isLoadingMore, isComplete, handleAnswer } =
    useQuestionnaire();
  const isGenerateDisabled = !isAdmin && !quotaLoading && remainingGenerations <= 0;

  if (isLoadingMore) {
    return (
      <div className="min-h-screen text-white flex flex-col items-center justify-center gap-6" style={BG_STYLE}>
        <div className="fixed top-0 left-0 right-0 h-[2px] bg-gray-900 z-50">
          <div className="h-full bg-blue-500 w-[60%] transition-all duration-500" />
        </div>
        <BrandBar />
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm tracking-wide">Tailoring questions for your project…</p>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="min-h-screen text-white flex flex-col items-center justify-center gap-8 px-4" style={BG_STYLE}>
        <div className="fixed top-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
        <BrandBar />
        <GenerateButton
          onClick={() => onComplete(answers)}
          allAnswers={answers}
          remainingGenerations={remainingGenerations}
          generationLimit={generationLimit}
          quotaLoading={quotaLoading}
          isAdmin={isAdmin}
          disabled={isGenerateDisabled}
          disabledMessage={quotaExhaustedMessage}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white" style={BG_STYLE}>
      <BrandBar />
      <main className="flex min-h-screen items-center justify-center px-4 pt-16">
        <div className="w-full max-w-lg">
          <ProgressBar total={allQuestions.length} current={currentIndex} loadingMore={false} />
          {currentQuestion && (
            <QuestionCard
              question={currentQuestion}
              currentAnswer={answers[currentQuestion.id]}
              onAnswer={handleAnswer}
              visible={visible}
            />
          )}
        </div>
      </main>
    </div>
  );
}
