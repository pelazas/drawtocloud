"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleUserRound, LogOut } from "lucide-react";
import { useAuth } from "@/components/auth/useAuth";

export default function UserMenu() {
  const { user, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  async function handleSignOut() {
    await signOut();
    setIsOpen(false);
  }

  if (!user) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200 hover:border-gray-600 transition-colors"
      >
        <CircleUserRound size={16} />
        <span className="hidden sm:inline truncate max-w-32">{user.email}</span>
        <ChevronDown size={14} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-gray-700 bg-gray-900 shadow-xl shadow-black/30 p-2 z-20">
          <p className="px-2 py-2 text-xs text-gray-400">Signed in as</p>
          <p className="px-2 pb-2 text-sm text-gray-100 truncate border-b border-gray-700">{user.email}</p>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-2 w-full flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
