import type { ConnectionState } from "./websocket";

type ShouldHydrateFromProjectArgs = {
  isFreshSession: boolean;
  projectUpdatedAt: string;
  lastHydratedUpdatedAt: string | null;
  generationActive: boolean;
  liveSession: boolean;
  wsState: ConnectionState;
};

export function shouldHydrateFromProject({
  isFreshSession,
  projectUpdatedAt,
  lastHydratedUpdatedAt,
  generationActive,
  liveSession,
  wsState,
}: ShouldHydrateFromProjectArgs): boolean {
  if (isFreshSession) {
    return true;
  }

  if (projectUpdatedAt === lastHydratedUpdatedAt) {
    return false;
  }

  // While generation is active and WS is open for live sessions, WS events are authoritative.
  if (generationActive && liveSession && wsState === "open") {
    return false;
  }

  return true;
}
