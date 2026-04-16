"use client";

import ChatMessageMarkdown from "@/components/ChatMessageMarkdown";

interface ChatMessageBubbleProps {
  role: "user" | "assistant";
  content: string;
}

export default function ChatMessageBubble({ role, content }: ChatMessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
          isUser ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-100"
        }`}
      >
        {role === "assistant" ? (
          <ChatMessageMarkdown content={content} />
        ) : (
          content
        )}
      </div>
    </div>
  );
}
