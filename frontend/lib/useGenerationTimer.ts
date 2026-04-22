import { useEffect } from "react";

export function useGenerationTimer({
  isGenerating,
  generationStartedAt,
  generationStartedAtRef,
  setGenerationElapsed,
}: {
  isGenerating: boolean;
  generationStartedAt: number | null;
  generationStartedAtRef: React.MutableRefObject<number | null>;
  setGenerationElapsed: React.Dispatch<React.SetStateAction<number>>;
}) {
  useEffect(() => {
    if (!isGenerating || generationStartedAtRef.current === null) {
      return;
    }
    const tick = () => {
      const start = generationStartedAtRef.current;
      if (start !== null) {
        setGenerationElapsed(Math.floor((Date.now() - start) / 1000));
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, generationStartedAt]);
}
