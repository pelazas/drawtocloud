import React from "react";
import { AbsoluteFill, Audio, Sequence, Series, staticFile, useVideoConfig } from "remotion";
import { SceneCanvas } from "./SceneCanvas";
import { SceneIntro } from "./SceneIntro";
import { SceneOutro } from "./SceneOutro";
import { SceneWorkflow } from "./SceneWorkflow";

export const DrawToCloudPromo2: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c" }}>
      <Audio
        src={staticFile("bg-music.wav")}
        volume={(f) => {
          const fadeIn = Math.min(1, f / 45);
          const fadeOut = Math.min(1, Math.max(0, (durationInFrames - f) / 60));
          return 0.52 * fadeIn * fadeOut;
        }}
      />
      <Sequence from={892}>
        <Audio
          src={staticFile("bg-epic-overlay.wav")}
          volume={(f) => {
            const rise = Math.min(1, f / 70);
            const fadeOut = Math.min(1, Math.max(0, (durationInFrames - (892 + f)) / 60));
            return 0.34 * rise * fadeOut;
          }}
        />
      </Sequence>
      <Series>
        <Series.Sequence durationInFrames={90} premountFor={fps}>
          <SceneIntro />
        </Series.Sequence>
        <Series.Sequence durationInFrames={845} premountFor={fps}>
          <SceneWorkflow />
        </Series.Sequence>
        <Series.Sequence durationInFrames={358} premountFor={fps}>
          <SceneCanvas />
        </Series.Sequence>
        <Series.Sequence durationInFrames={90} premountFor={fps}>
          <SceneOutro />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
