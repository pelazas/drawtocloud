"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

interface InfoHintProps {
  label: string;
  children: ReactNode;
}

export default function InfoHint({ label, children }: InfoHintProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hintId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-flex" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[rgb(55_55_68)] bg-[rgb(18_18_24)] text-gray-400 transition-colors hover:text-gray-200 hover:border-[rgb(86_86_110)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
        aria-label={label}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={isOpen ? hintId : undefined}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M7.9 7.7A2.2 2.2 0 0 1 10 6.5c1.3 0 2.3.8 2.3 2.1 0 1.2-.8 1.8-1.6 2.3-.6.4-.9.7-.9 1.4v.2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="10" cy="14.8" r="0.9" fill="currentColor" />
        </svg>
      </button>

      {isOpen ? (
        <div
          id={hintId}
          role="dialog"
          className="absolute left-0 top-[calc(100%+8px)] z-20 w-72 rounded-lg border border-[rgb(52_52_64)] bg-[rgb(14_14_18)] p-3 text-xs leading-relaxed text-gray-300 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
