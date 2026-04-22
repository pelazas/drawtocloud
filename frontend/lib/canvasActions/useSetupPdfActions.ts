import { useCallback } from "react";
import {
  fetchSetupPdfDownloadUrl,
  generateSetupPdf,
  normalizeSetupPdfStatus,
  type SetupPdfState,
} from "../setupPdf";

export function useSetupPdfActions({
  activeProjectId,
  generationCompleted,
  readOnly,
  setSetupPdfState,
}: {
  activeProjectId: string | null;
  generationCompleted: boolean;
  readOnly: boolean;
  setSetupPdfState: React.Dispatch<React.SetStateAction<SetupPdfState>>;
}) {
  const requestSetupPdfGeneration = useCallback(async () => {
    if (!activeProjectId || !generationCompleted || readOnly) return;

    setSetupPdfState((prev) => ({
      ...prev,
      status: "generating",
      progress: Math.max(prev.progress, 0),
      error: null,
    }));

    try {
      const result = await generateSetupPdf(activeProjectId);
      setSetupPdfState((prev) => ({
        ...prev,
        status: normalizeSetupPdfStatus(result.setup_pdf_status),
        progress: Math.max(0, Math.min(100, Math.round(result.setup_pdf_progress))),
        error: result.setup_pdf_error,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate setup PDF.";
      setSetupPdfState((prev) => ({
        ...prev,
        status: "failed",
        error: message,
      }));
    }
  }, [activeProjectId, generationCompleted, readOnly, setSetupPdfState]);

  const requestSetupPdfDownload = useCallback(async () => {
    if (!activeProjectId || readOnly) return;

    try {
      const result = await fetchSetupPdfDownloadUrl(activeProjectId);
      setSetupPdfState((prev) => ({
        ...prev,
        status: normalizeSetupPdfStatus(result.setup_pdf_status),
        error: null,
      }));
      if (typeof window !== "undefined") {
        window.open(result.download_url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch setup PDF download URL.";
      setSetupPdfState((prev) => ({
        ...prev,
        error: message,
      }));
    }
  }, [activeProjectId, readOnly, setSetupPdfState]);

  return { requestSetupPdfGeneration, requestSetupPdfDownload };
}
