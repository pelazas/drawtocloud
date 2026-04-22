import { useCallback, useRef } from "react";
import { handlePipelineMessage, type PipelineMessageHandlerDeps } from "./pipelineMessageHandler";

export function usePipelineMessageHandler(deps: PipelineMessageHandlerDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  return useCallback((data: unknown) => {
    handlePipelineMessage(data, depsRef.current);
  }, []);
}
