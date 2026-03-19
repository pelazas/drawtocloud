export function shouldApplyLayoutOnPipelineEvent(stage: string | null, eventName: string | null): boolean {
  return stage === "architect" && eventName === "completed";
}
