import React from "react";
import { AbsoluteFill, Series, useVideoConfig } from "remotion";
import { SceneCanvas } from "./SceneCanvas";
import { SceneIntro } from "./SceneIntro";
import { SceneOutro } from "./SceneOutro";
import { SceneWorkflow } from "./SceneWorkflow";

export const DrawToCloudPromo2: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#02040c" }}>
      <Series>
        <Series.Sequence durationInFrames={90} premountFor={fps}>
          <SceneIntro />
        </Series.Sequence>
        <Series.Sequence durationInFrames={860} premountFor={fps}>
          <SceneWorkflow />
        </Series.Sequence>
        <Series.Sequence durationInFrames={240} premountFor={fps}>
          <SceneCanvas />
        </Series.Sequence>
        <Series.Sequence durationInFrames={90} premountFor={fps}>
          <SceneOutro />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
