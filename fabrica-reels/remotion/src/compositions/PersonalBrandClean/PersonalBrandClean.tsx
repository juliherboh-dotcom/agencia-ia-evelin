import React, { useMemo } from "react";
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditSpec } from "../../../../schema/edit-spec.zod";
import { SubtitleLayer } from "./SubtitleLayer";
import { HookHeadline } from "./HookHeadline";
import { ProgressBar } from "./ProgressBar";
import { EmphasisOverlay } from "./EmphasisOverlay";
import { SfxLayer } from "./SfxLayer";
import { secondsToFrames } from "../../utils/time";
import { buildKeptSegments } from "../../utils/cuts";

/**
 * Composition "PersonalBrandClean" — template de referencia de la Fábrica
 * de Reels (Capa 4).
 *
 * Las props son literalmente el EditSpec validado por
 * `validateEditSpec()` (Capa 3 -> Capa 4): no hay una capa de mapeo
 * intermedia. Si el spec pasó la validación, este componente puede confiar
 * en su forma sin volver a chequear nada acá — separación de
 * responsabilidades: validar es trabajo de la Capa 3/servicio de render,
 * no de la Composition.
 */
export const PersonalBrandClean: React.FC<EditSpec> = (spec) => {
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();

  const zoomScale = useMemo(() => {
    if (spec.zoom_keyframes.length === 0) return 1;
    if (spec.zoom_keyframes.length === 1) return spec.zoom_keyframes[0].scale;

    const inputRange = spec.zoom_keyframes.map((kf) => secondsToFrames(kf.t, fps));
    const outputRange = spec.zoom_keyframes.map((kf) => kf.scale);

    return interpolate(frame, inputRange, outputRange, {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.quad),
    });
  }, [frame, fps, spec.zoom_keyframes]);

  // Corte de silencios/muletillas real: cada tramo "keep:true" de cuts[]
  // se reproduce como su propio <Sequence> en la línea de tiempo FINAL,
  // recortado del video fuente con trimBefore/trimAfter -- los tramos
  // "keep:false" simplemente no aparecen. Antes el render ignoraba
  // cuts[] por completo (reproducía el video fuente entero); ver
  // ../../utils/cuts.ts para la razón de ser de esto.
  const segments = useMemo(() => buildKeptSegments(spec.cuts, fps), [spec.cuts, fps]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Video fuente, recortado por cuts[], con zoom sutil encima */}
      <AbsoluteFill style={{ transform: `scale(${zoomScale})`, transformOrigin: "center center" }}>
        {segments.map((segment, i) => (
          <Sequence key={i} from={segment.outputStartFrame} durationInFrames={segment.durationFrames} layout="none">
            <OffthreadVideo
              src={spec.source_video.url}
              trimBefore={segment.sourceStartFrame}
              trimAfter={segment.sourceEndFrame}
            />
          </Sequence>
        ))}
      </AbsoluteFill>

      {/* Overlays de énfasis puntuales (badges/texto/imagen) */}
      {spec.overlays.map((overlay) => (
        <EmphasisOverlay
          key={overlay.id}
          overlay={overlay}
          width={width}
          height={height}
          accentColor={spec.branding.accent_color}
        />
      ))}

      {/* Hook grande arriba, solo durante su ventana de aparición */}
      <Sequence
        from={secondsToFrames(spec.hook.display_start, fps)}
        durationInFrames={secondsToFrames(spec.hook.display_end - spec.hook.display_start, fps)}
        layout="none"
      >
        <HookHeadline hook={spec.hook} accentColor={spec.branding.accent_color} />
      </Sequence>

      {/* Efectos de sonido puntuales (whoosh, pop, ding) */}
      <SfxLayer cues={spec.sfx} />

      {/* Subtítulos animados */}
      <SubtitleLayer lines={spec.subtitles.lines} style={spec.subtitles.style} />

      {/* Barra de progreso */}
      {spec.progress_bar.enabled && <ProgressBar color={spec.progress_bar.color} />}
    </AbsoluteFill>
  );
};
