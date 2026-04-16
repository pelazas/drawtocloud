"use client";

import { useState, useRef, useEffect, type RefObject } from "react";
import type { ChatSelectionNode } from "@/components/ChatSelectionChips";
import type { CanvasMessage } from "@/lib/projects";
import {
  latestPlanMessageIndex,
  latestPendingBudgetRecoveryMessageIndex,
} from "./chatMessageState";

interface UseChatOptions {
  messages: CanvasMessage[];
  onSend: (message: string, selectedNodeIds: string[]) => void;
  selectedNodes: ChatSelectionNode[];
  disabled?: boolean;
  readOnly?: boolean;
  isTyping?: boolean;
}

interface UseChatReturn {
  input: string;
  setInput: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  bottomRef: RefObject<HTMLDivElement>;
  submitMessage: () => void;
  handleSubmit: (e: React.FormEvent) => void;
  handleTextareaKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  latestPlanMessageIndex: number;
  latestPendingBudgetRecoveryMessageIndex: number;
}

const COMPOSER_MIN_HEIGHT_PX = 40;
const COMPOSER_MAX_HEIGHT_PX = 160;

export function useChat({
  messages,
  onSend,
  selectedNodes,
  disabled = false,
  readOnly = false,
  isTyping = false,
}: UseChatOptions): UseChatReturn {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const prevIsTypingRef = useRef(isTyping);

  const planIdx = latestPlanMessageIndex(messages);
  const budgetIdx = latestPendingBudgetRecoveryMessageIndex(messages);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!prevIsTypingRef.current && isTyping) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevIsTypingRef.current = isTyping;
  }, [isTyping]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = `${COMPOSER_MIN_HEIGHT_PX}px`;
    const nextHeight = Math.min(
      Math.max(textarea.scrollHeight, COMPOSER_MIN_HEIGHT_PX),
      COMPOSER_MAX_HEIGHT_PX
    );
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [input]);

  function submitMessage() {
    if (disabled || readOnly) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed, selectedNodes.map((node) => node.id));
    setInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitMessage();
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (
      isComposingRef.current ||
      e.nativeEvent.isComposing ||
      e.nativeEvent.keyCode === 229
    )
      return;

    e.preventDefault();
    submitMessage();
  }

  function onCompositionStart() {
    isComposingRef.current = true;
  }

  function onCompositionEnd() {
    isComposingRef.current = false;
  }

  return {
    input,
    setInput,
    textareaRef,
    bottomRef,
    submitMessage,
    handleSubmit,
    handleTextareaKeyDown,
    onCompositionStart,
    onCompositionEnd,
    latestPlanMessageIndex: planIdx,
    latestPendingBudgetRecoveryMessageIndex: budgetIdx,
  };
}
