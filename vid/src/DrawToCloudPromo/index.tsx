import React from "react";
import { AbsoluteFill, Audio, staticFile, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { Scene1Hook } from "../Scene1Hook";
import { Scene2Input } from "../Scene2Input";
import { Scene3Generation } from "../Scene3Generation";
import { Scene4Iteration } from "../Scene4Iteration";
import { Scene5Export } from "../Scene5Export";
import { Scene6CTA } from "../Scene6CTA";

export const DrawToCloudPromo: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c" }}>
      <Audio
        src={staticFile("mindfulliving-soft-circuit-flow-modern-ambient-background-music-469975.mp3")}
        volume={(f) => {
          const fadeIn = Math.min(1, f / 30);
          const fadeOutStart = durationInFrames - 90;
          const fadeOut = Math.min(1, Math.max(0, (durationInFrames - f) / 90));
          return 0.45 * fadeIn * fadeOut;
        }}
      />

      <TransitionSeries>
      {/* Scene 1 — Hook (0–3.67s) */}
      <TransitionSeries.Sequence durationInFrames={110} premountFor={10}>
        <Scene1Hook />
      </TransitionSeries.Sequence>

      {/* Hook → Input: fade 10 frames */}
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 10 })}
      />

      {/* Scene 2 — Input (3.67–12.33s) */}
      <TransitionSeries.Sequence durationInFrames={260} premountFor={10}>
        <Scene2Input />
      </TransitionSeries.Sequence>

      {/* Input → Generation: fade 8 frames */}
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 8 })}
      />

      {/* Scene 3 — Generation (12.33–18.33s) */}
      <TransitionSeries.Sequence durationInFrames={180} premountFor={10}>
        <Scene3Generation />
      </TransitionSeries.Sequence>

      {/* Generation → Iteration: cut (no transition) */}

      {/* Scene 4 — Iteration (19.33–32.83s) */}
      <TransitionSeries.Sequence durationInFrames={405} premountFor={10}>
        <Scene4Iteration />
      </TransitionSeries.Sequence>

      {/* Iteration → Export: wipe from-right 15 frames */}
      <TransitionSeries.Transition
        presentation={wipe({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: 15 })}
      />

      {/* Scene 5 — Export (32.83–40.83s) */}
      <TransitionSeries.Sequence durationInFrames={240} premountFor={10}>
        <Scene5Export />
      </TransitionSeries.Sequence>

      {/* Export → CTA: fade 12 frames */}
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 12 })}
      />

      {/* Scene 6 — CTA (40.83–43.83s) */}
      <TransitionSeries.Sequence durationInFrames={90} premountFor={10}>
        <Scene6CTA />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
  );
};
