import { useCallback, useEffect, useRef, useState } from "react";
import wsClient, { type ConnectionState } from "@/lib/websocket";
import { withAccessToken } from "@/lib/generationStart";

export type WebSocketConnectionOptions = {
  enabled: boolean;
  onMessage: (data: unknown) => void;
  onConnectionState?: (state: ConnectionState) => void;
  desiredProjectSubscriptionRef?: React.MutableRefObject<string | null>;
};

export function useWebSocketConnection(options: WebSocketConnectionOptions) {
  const { enabled, onMessage, onConnectionState, desiredProjectSubscriptionRef: externalDesiredProjectSubscriptionRef } = options;

  const [wsState, setWsState] = useState<ConnectionState>("idle");
  const onMessageRef = useRef(onMessage);
  const onConnectionStateRef = useRef(onConnectionState);
  const subscribedProjectRef = useRef<string | null>(null);
  const internalDesiredProjectSubscriptionRef = useRef<string | null>(null);
  const desiredProjectSubscriptionRef = externalDesiredProjectSubscriptionRef ?? internalDesiredProjectSubscriptionRef;

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onConnectionStateRef.current = onConnectionState;
  }, [onConnectionState]);

  const subscribeProject = useCallback(async (projectId: string) => {
    const payload = await withAccessToken({ type: "subscribe_project", project_id: projectId });
    const sent = wsClient.send(payload);
    if (sent) {
      subscribedProjectRef.current = projectId;
    }
    return sent;
  }, []);

  const queueProjectSubscription = useCallback(
    (projectId: string | null) => {
      desiredProjectSubscriptionRef.current = projectId;
      if (!projectId) return;
      void subscribeProject(projectId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscribeProject]
  );

  useEffect(() => {
    if (!enabled) {
      desiredProjectSubscriptionRef.current = null;
      return;
    }

    wsClient.connect();

    const unsubscribeConnection = wsClient.onConnectionState((state) => {
      setWsState(state);
      onConnectionStateRef.current?.(state);

      if (state !== "open") {
        subscribedProjectRef.current = null;
        return;
      }

      const desiredProjectId = desiredProjectSubscriptionRef.current;
      if (desiredProjectId && desiredProjectId !== subscribedProjectRef.current) {
        void subscribeProject(desiredProjectId);
      }
    });

    const unsubscribeMessages = wsClient.onMessage((data: unknown) => {
      onMessageRef.current(data);
    });

    const handleBeforeUnload = () => {
      wsClient.disconnect();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      unsubscribeMessages();
      unsubscribeConnection();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      wsClient.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, subscribeProject]);

  const reconnect = useCallback(() => {
    wsClient.reconnect();
  }, []);

  return {
    wsState,
    subscribeProject,
    queueProjectSubscription,
    reconnect,
    subscribedProjectRef,
    desiredProjectSubscriptionRef,
  };
}
