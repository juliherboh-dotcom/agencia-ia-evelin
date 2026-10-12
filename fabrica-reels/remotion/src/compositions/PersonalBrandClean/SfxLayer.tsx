import React from "react";
import { Html5Audio, Sequence, useVideoConfig } from "remotion";
import type { SfxCue } from "../../../../schema/edit-spec.zod";
import { secondsToFrames } from "../../utils/time";
import { dbToLinearVolume } from "../../utils/audio";

const DEFAULT_SFX_VOLUME_DB = -6;
// Ventana generosa para que el clip de sonido (típicamente 0.2-1s) entre
// completo sin que el <Sequence> lo corte -- no hay un campo de duración
// por cue en el contrato, se apoya en que el propio archivo de audio es
// corto y en que Html5Audio no se reproduce más allá de su propio largo.
const SFX_SEQUENCE_DURATION_SEC = 2;

/**
 * Efectos de sonido puntuales (whoosh, pop, ding) en momentos concretos
 * del video -- distinto de `music` (pista de fondo), que es un campo
 * aparte y que, a diferencia de este, ningún render resuelve todavía.
 */
export const SfxLayer: React.FC<{ cues: SfxCue[] }> = ({ cues }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {cues.map((cue) => (
        <Sequence
          key={cue.id}
          from={secondsToFrames(cue.t, fps)}
          durationInFrames={secondsToFrames(SFX_SEQUENCE_DURATION_SEC, fps)}
          layout="none"
        >
          <Html5Audio src={cue.sound_url} volume={dbToLinearVolume(cue.volume_db ?? DEFAULT_SFX_VOLUME_DB)} />
        </Sequence>
      ))}
    </>
  );
};
