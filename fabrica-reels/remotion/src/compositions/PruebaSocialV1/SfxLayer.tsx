import React from "react";
import { Html5Audio, Sequence, useVideoConfig } from "remotion";
import type { SfxCue } from "../../../../schema/edit-spec.zod";
import { secondsToFrames } from "../../utils/time";
import { dbToLinearVolume } from "../../utils/audio";

// Copia intencional de compositions/PersonalBrandClean/SfxLayer.tsx, sin
// cambios de lógica (ver nota en SubtitleLayer.tsx de esta misma carpeta).
const DEFAULT_SFX_VOLUME_DB = -6;
const SFX_SEQUENCE_DURATION_SEC = 2;

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
