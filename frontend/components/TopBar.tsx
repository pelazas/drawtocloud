"use client";

import { useMemo, useState } from "react";
import UserMenu from "@/components/UserMenu";
import type { DebugEvent } from "@/lib/useCanvasPipeline";
import type { ConnectionState } from "@/lib/websocket";

interface Props {
  message: string | null;
  remainingGenerations: number;
  generationLimit: number;
  quotaLoading: boolean;
  ticker?: string[];
  wsState?: ConnectionState;
  currentStage?: string | null;
  traceId?: string | null;
  lastEventAt?: number | null;
  debugEvents?: DebugEvent[];
  onReconnect?: () => void;
  onCopyDebug?: () => void;
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
  ticker = [],
  wsState = "idle",
  currentStage = null,
  traceId = null,
  lastEventAt = null,
  debugEvents = [],
  onReconnect,
  onCopyDebug,
}: Props) {
  const [debugOpen, setDebugOpen] = useState(false);
  const isDone = message?.startsWith("Architecture ready") ?? false;
  const quotaLabel = quotaLoading
    ? "Checking quota..."
    : `${remainingGenerations}/${generationLimit} generations remaining`;

  const recentDebugEvents = useMemo(() => [...debugEvents].slice(-30).reverse(), [debugEvents]);

  return (
    <div className="border-b border-gray-700 bg-gray-900">
      <div className="px-4 py-2 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-sm font-semibold text-white">DrawToCloud</h1>
          <p className="text-xs text-gray-500">Describe your infrastructure</p>
        </div>

        <div className="flex items-center gap-2">
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
          <p className="text-xs text-gray-400">{quotaLabel}</p>
          <UserMenu />
        </div>
      </div>

      {ticker.length > 0 && (
        <div className="px-4 pb-2 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {ticker.map((item, index) => (
              <span
                key={`${item}-${index}`}
                className="text-[10px] px-2 py-1 rounded border border-gray-700 bg-gray-800 text-gray-300"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {message && (
        <div className={`px-4 py-2 text-sm text-center ${isDone ? "bg-green-950 text-green-400" : "bg-gray-900 text-gray-400"}`}>
          {message}
        </div>
      )}

      {debugOpen && (
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
