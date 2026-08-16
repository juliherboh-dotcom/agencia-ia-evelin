import React from "react";
import { Composition } from "remotion";
import { PersonalBrandClean } from "./compositions/PersonalBrandClean/PersonalBrandClean";
import { EditSpecSchema, type EditSpec } from "../../schema/edit-spec.zod";
import exampleSpec from "../sample-data/example-edit-spec.json";

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PersonalBrandClean"
        component={PersonalBrandClean}
        // Reutilizamos el mismo schema de Zod que valida el edit_spec antes
        // de renderizar (Capa 3 -> Capa 4). Esto también le da a Remotion
        // Studio los controles editables de props "gratis", sin duplicar
        // la definición de tipos en un tercer lugar.
        schema={EditSpecSchema}
        durationInFrames={Math.round((exampleSpec as EditSpec).duration.target_sec * FPS)}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={exampleSpec as EditSpec}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: Math.round(props.duration.target_sec * FPS),
          fps: FPS,
          width: 1080,
          height: 1920,
        })}
      />
    </>
  );
};
