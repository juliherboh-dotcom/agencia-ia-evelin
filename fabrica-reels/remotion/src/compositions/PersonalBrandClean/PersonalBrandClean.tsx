import React, { useMemo } from "react";
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditSpec } from "../../../../schema/edit-spec.zod";
import { SubtitleLayer } from "./SubtitleLayer";
import { HookHeadline } from "./HookHeadline";
import { ProgressBar } from "./ProgressBar";
import { LogoWatermark } from "./LogoWatermark";
import { EmphasisOverlay } from "./EmphasisOverlay";
import { secondsToFrames } from "../../utils/time";

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

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Video fuente con zoom sutil */}
      <AbsoluteFill style={{ transform: `scale(${zoomScale})`, transformOrigin: "center center" }}>
        <OffthreadVideo src={spec.source_video.url} />
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

      {/* Subtítulos animados */}
      <SubtitleLayer lines={spec.subtitles.lines} style={spec.subtitles.style} />

      {/* Barra de progreso */}
      {spec.progress_bar.enabled && <ProgressBar color={spec.progress_bar.color} />}

      {/* Logo pequeño de marca */}
      <LogoWatermark logoUrl={spec.branding.logo_url} position={spec.branding.watermark_position} />
    </AbsoluteFill>
  );
};
