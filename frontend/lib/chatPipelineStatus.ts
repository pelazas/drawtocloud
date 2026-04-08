export function clearTransientChatErrorStatus(status: string | null): string | null {
  if (typeof status !== "string") return status;
  return status.trim().toLowerCase().startsWith("error:") ? null : status;
}
