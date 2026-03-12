import { useState, useCallback } from "react";

export type QuestionType = "single_select" | "multi_select" | "free_text";

export interface Question {
  id: string;
  prompt: string;
  type: QuestionType;
  options: string[] | null;
  allow_custom: boolean;
}

type QState = "SHOWING_FIXED" | "LOADING_PERSONALIZED" | "SHOWING_PERSONALIZED" | "COMPLETE";

export const FIXED_QUESTIONS: Question[] = [
  {
    id: "app_type",
    prompt: "What are you building?",
    type: "single_select",
    options: [
      "\u{1F310} Web app or SaaS",
      "\u{1F4F1} Mobile backend / API",
      "\u{1F916} AI / ML workload",
      "\u{1F504} Data pipeline or ETL",
      "\u{1F6D2} E-commerce platform",
      "\u{1F3E2} Internal tooling",
      "\u{270F}\u{FE0F} Other",
    ],
    allow_custom: true,
  },
  {
    id: "stage",
    prompt: "What stage is this?",
    type: "single_select",
    options: ["\u{1F9EA} Prototype", "\u{1F680} MVP", "\u{1F4C8} Growth", "\u{1F3ED} Production"],
    allow_custom: false,
  },
  {
    id: "team_size",
    prompt: "What's your team size?",
    type: "single_select",
    options: ["\u{1F9D1} Solo founder", "\u{1F465} 2\u20135 people", "\u{1F3E2} 6\u201320 people", "\u{1F3ED} 20+ people"],
    allow_custom: false,
  },
];

export function useQuestionnaire() {
  const [qState, setQState] = useState<QState>("SHOWING_FIXED");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [personalizedQuestions, setPersonalizedQuestions] = useState<Question[]>([]);
  const [visible, setVisible] = useState(true);

  const allQuestions = [...FIXED_QUESTIONS, ...personalizedQuestions];
  const currentQuestion = allQuestions[currentIndex];
  const isLoadingMore = qState === "LOADING_PERSONALIZED";
  const isComplete = qState === "COMPLETE";

  const advanceWithAnimation = useCallback((nextIndex: number) => {
    setVisible(false);
    setTimeout(() => { setCurrentIndex(nextIndex); setVisible(true); }, 300);
  }, []);

  const fetchPersonalizedQuestions = useCallback(async (currentAnswers: Record<string, string | string[]>) => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    try {
      const res = await fetch(`${API_URL}/api/questionnaire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: Object.fromEntries(
            Object.entries(currentAnswers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v])
          ),
        }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const collected: Question[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (parsed.done) {
            setPersonalizedQuestions(collected);
            setQState("SHOWING_PERSONALIZED");
            setCurrentIndex(FIXED_QUESTIONS.length);
            setVisible(true);
            return;
          }
          if (parsed.question) collected.push(parsed.question);
        }
      }
      setPersonalizedQuestions(collected);
      setQState(collected.length > 0 ? "SHOWING_PERSONALIZED" : "COMPLETE");
      if (collected.length > 0) setCurrentIndex(FIXED_QUESTIONS.length);
      setVisible(true);
    } catch (err) {
      console.error("Failed to fetch personalized questions:", err);
      setQState("COMPLETE");
    }
  }, []);

  const handleAnswer = useCallback((id: string, value: string | string[]) => {
    const newAnswers = { ...answers, [id]: value };
    setAnswers(newAnswers);
    if (qState === "SHOWING_FIXED") {
      if (currentIndex < 2) {
        advanceWithAnimation(currentIndex + 1);
      } else {
        setQState("LOADING_PERSONALIZED");
        setVisible(false);
        fetchPersonalizedQuestions(newAnswers);
      }
    } else if (qState === "SHOWING_PERSONALIZED") {
      const personalizedIndex = currentIndex - FIXED_QUESTIONS.length;
      if (personalizedIndex < personalizedQuestions.length - 1) advanceWithAnimation(currentIndex + 1);
      else setQState("COMPLETE");
    }
  }, [answers, qState, currentIndex, personalizedQuestions.length, advanceWithAnimation, fetchPersonalizedQuestions]);

  return { allQuestions, currentQuestion, currentIndex, answers, visible, isLoadingMore, isComplete, handleAnswer };
}
