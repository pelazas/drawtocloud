import "./index.css";
import { Composition } from "remotion";
import { DrawToCloudPromo2 } from "./DrawToCloudPromo2";
import { HelloWorld, myCompSchema } from "./HelloWorld";
import { Logo, myCompSchema2 } from "./HelloWorld/Logo";
import { Scene3Generation } from "./Scene3Generation";
import { Scene1Hook } from "./Scene1Hook";
import { Scene2Input } from "./Scene2Input";
import { Scene6CTA } from "./Scene6CTA";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Scene2Input"
        component={Scene2Input}
        durationInFrames={260}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="Scene1Hook"
        component={Scene1Hook}
        durationInFrames={110}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="Scene6CTA"
        component={Scene6CTA}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="Scene3Generation"
        component={Scene3Generation}
        durationInFrames={210}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="DrawToCloudPromo2"
        component={DrawToCloudPromo2}
        durationInFrames={1383}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="HelloWorld"
        component={HelloWorld}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        schema={myCompSchema}
        defaultProps={{
          titleText: "Welcome to Remotion",
          titleColor: "#000000",
          logoColor1: "#91EAE4",
          logoColor2: "#86A8E7",
        }}
      />

      <Composition
        id="OnlyLogo"
        component={Logo}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        schema={myCompSchema2}
        defaultProps={{
          logoColor1: "#91dAE2" as const,
          logoColor2: "#86A8E7" as const,
        }}
      />
    </>
  );
};
