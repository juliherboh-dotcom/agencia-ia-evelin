import type { Cut } from "../../../schema/edit-spec.zod";
import { secondsToFrames } from "./time";

export type KeptSegment = {
  /** Frame en la línea de tiempo FUENTE donde arranca el tramo (trimBefore de OffthreadVideo). */
  sourceStartFrame: number;
  /** Frame en la línea de tiempo FUENTE donde termina (trimAfter de OffthreadVideo). */
  sourceEndFrame: number;
  /** Frame en la línea de tiempo FINAL ya editada donde va este <Sequence>. */
  outputStartFrame: number;
  /** Duración en frames (igual en origen y destino: no hay time-lapse/slow-mo acá). */
  durationFrames: number;
};

/**
 * Convierte `cuts[]` (línea de tiempo del video FUENTE, ver la "regla más
 * importante" en edit-spec.schema.json) en los tramos a reproducir, ya
 * ubicados en la línea de tiempo FINAL editada -- descartando los cuts
 * con `keep:false` (silencios, muletillas).
 *
 * Hasta ahora ninguna Composition usaba esto para recortar de verdad: el
 * render reproducía `source_video.url` entero, y `cuts[]` solo servía
 * para la validación (duración objetivo, que no se solapen). Esta
 * función es la pieza que faltaba para que el corte de silencios se vea
 * de verdad en el video final, no solo en el dato.
 */
export function buildKeptSegments(cuts: Cut[], fps: number): KeptSegment[] {
  const sorted = [...cuts].filter((c) => c.keep).sort((a, b) => a.start - b.start);

  let outputFrame = 0;
  return sorted.map((cut) => {
    const sourceStartFrame = secondsToFrames(cut.start, fps);
    const sourceEndFrame = secondsToFrames(cut.end, fps);
    const durationFrames = sourceEndFrame - sourceStartFrame;

    const segment: KeptSegment = {
      sourceStartFrame,
      sourceEndFrame,
      outputStartFrame: outputFrame,
      durationFrames,
    };
    outputFrame += durationFrames;
    return segment;
  });
}
