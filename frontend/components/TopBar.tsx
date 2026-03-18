"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import UserMenu from "@/components/UserMenu";
import { formatBudgetRetryStatus, type BudgetRetryState } from "@/lib/budgetRetry";
import type { DebugEvent } from "@/lib/useCanvasPipeline";
import type { ConnectionState } from "@/lib/websocket";

interface Props {
  message: string | null;
  remainingGenerations: number;
  generationLimit: number;
  quotaLoading: boolean;
  isAdmin?: boolean;
  wsState?: ConnectionState;
  currentStage?: string | null;
  traceId?: string | null;
  lastEventAt?: number | null;
  budgetRetryState?: BudgetRetryState;
  debugEvents?: DebugEvent[];
  onReconnect?: () => void;
  onCopyDebug?: () => void;
  mode?: "owner" | "public";
  shareSlug?: string | null;
  showBackToDashboard?: boolean;
}

function formatAge(lastEventAt?: number | null): string {
  if (!lastEventAt) return "n/a";
  const seconds = Math.max(Math.floor((Date.now() - lastEventAt) / 1000), 0);
  return `${seconds}s ago`;
}

function wsBadgeClass(state: ConnectionState): string {
  if (state === "open") return "bg-green-900/60 text-green-300 border-green-700";
  if (state === "connecting") return "bg-blue-900/60 text-blue-300 border-blue-700";
  if (state === "error") return "bg-red-900/60 text-red-300 border-red-700";
  if (state === "closed") return "bg-orange-900/60 text-orange-300 border-orange-700";
  return "bg-gray-800 text-gray-300 border-gray-700";
}

export default function TopBar({
  message,
  remainingGenerations,
  generationLimit,
  quotaLoading,
  isAdmin = false,
  wsState = "idle",
  currentStage = null,
  traceId = null,
  lastEventAt = null,
  budgetRetryState = undefined,
  debugEvents = [],
  onReconnect,
  onCopyDebug,
  mode = "owner",
  shareSlug = null,
  showBackToDashboard = false,
}: Props) {
  const [debugOpen, setDebugOpen] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const isDone = message?.startsWith("Architecture ready") ?? false;
  const isOwner = mode === "owner";
  const budgetRetryMessage = budgetRetryState ? formatBudgetRetryStatus(budgetRetryState) : null;
  const quotaLabel = quotaLoading
    ? "Checking quota..."
    : isAdmin
      ? "Unlimited generations"
      : `${remainingGenerations}/${generationLimit} generations remaining`;

  const recentDebugEvents = useMemo(() => [...debugEvents].slice(-30).reverse(), [debugEvents]);

  useEffect(() => {
    if (!shareNotice) return;
    const timer = setTimeout(() => setShareNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [shareNotice]);

  async function copyShareLink() {
    if (!shareSlug || typeof window === "undefined") return;

    const shareUrl = `${window.location.origin}/p/${shareSlug}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareNotice("Link copied! Anyone with this link can view your architecture.");
    } catch {
      setShareNotice("Unable to copy link. Please copy it from the address bar.");
    }
  }

  return (
    <div className="border-b border-gray-700 bg-gray-900 relative z-40">
      <div className="px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {showBackToDashboard && (
            <Link
              href="/"
              className="inline-flex items-center rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
            >
              Back to Dashboard
            </Link>
          )}
          <div>
            <h1 className="text-sm font-semibold text-white">DrawToCloud</h1>
            <p className="text-xs text-gray-500">
              {isOwner ? "Describe your infrastructure" : "Shared architecture (read-only)"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isOwner && (
            <>
              <span className={`text-[10px] px-2 py-1 border rounded ${wsBadgeClass(wsState)}`}>
                WS: {wsState}
              </span>
              <span className="text-[10px] px-2 py-1 border border-gray-700 rounded bg-gray-800 text-gray-300">
                Stage: {currentStage ?? "n/a"}
              </span>
              <button
                type="button"
                className="text-[10px] px-2 py-1 border border-gray-700 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
                onClick={() => setDebugOpen((prev) => !prev)}
              >
                {debugOpen ? "Hide Debug" : "Debug"}
              </button>
            </>
          )}
          {isOwner && shareSlug && (
            <button
              type="button"
              onClick={copyShareLink}
              className="text-[10px] px-2 py-1 border border-blue-600/60 rounded bg-blue-600/10 text-blue-200 hover:bg-blue-600/20"
            >
              Share
            </button>
          )}
          <p className="text-xs text-gray-400">{isOwner ? quotaLabel : "Shared link"}</p>
          {isOwner && <UserMenu />}
        </div>
      </div>

      {shareNotice && (
        <div className="px-4 pb-2 text-xs text-blue-200">{shareNotice}</div>
      )}

      {budgetRetryMessage && (
        <div
          className={`px-4 py-2 text-xs text-center ${
            budgetRetryState?.status === "failed"
              ? "bg-red-950 text-red-300"
              : budgetRetryState?.status === "succeeded"
                ? "bg-emerald-950 text-emerald-300"
                : "bg-amber-950 text-amber-200"
          }`}
        >
          {budgetRetryMessage}
        </div>
      )}

      {message && (
        <div
          className={`px-4 py-2 text-sm text-center ${
            isDone ? "bg-green-950 text-green-400" : "bg-gray-900 text-gray-400"
          }`}
        >
          {message}
        </div>
      )}

      {debugOpen && isOwner && (
        <div className="border-t border-gray-800 bg-gray-950 px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-gray-300">
            <div className="rounded border border-gray-800 bg-gray-900 px-2 py-1">Trace: {traceId ?? "n/a"}</div>
            <div className="rounded border border-gray-800 bg-gray-900 px-2 py-1">Stage: {currentStage ?? "n/a"}</div>
            <div className="rounded border border-gray-800 bg-gray-900 px-2 py-1">Last event: {formatAge(lastEventAt)}</div>
            <div className="rounded border border-gray-800 bg-gray-900 px-2 py-1">Events: {debugEvents.length}</div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onReconnect}
              className="text-[11px] px-2 py-1 rounded border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700"
            >
              Reconnect WS
            </button>
            <button
              type="button"
              onClick={onCopyDebug}
              className="text-[11px] px-2 py-1 rounded border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700"
            >
              Copy Debug Report
            </button>
          </div>

          <div className="max-h-48 overflow-y-auto rounded border border-gray-800 bg-black/30">
            {recentDebugEvents.length === 0 ? (
              <p className="text-[11px] text-gray-500 px-3 py-2">No debug events yet.</p>
            ) : (
              recentDebugEvents.map((event) => (
                <div key={event.id} className="px-3 py-2 border-b border-gray-800 text-[11px]">
                  <div className="flex items-center gap-2 text-gray-400">
                    <span>{new Date(event.ts).toLocaleTimeString()}</span>
                    <span className="uppercase">{event.level}</span>
                    <span>{event.source}</span>
                    <span>{event.stage ?? "-"}</span>
                  </div>
                  <div className="text-gray-200">{event.message}</div>
                </div>
              ))
            )}
          </div>

          <p className="text-[11px] text-gray-500">
            If it fails, check: browser console/network WS, this timeline, and backend logs filtered by trace id.
          </p>
        </div>
      )}
    </div>
  );
}
