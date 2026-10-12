import React, { useMemo } from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditSpec } from "../../../../schema/edit-spec.zod";
import { ComparePanelVideo } from "./ComparePanelVideo";
import { CompareTopLabel, CompareBottomLabel } from "./CompareLabels";
import { HookPill } from "./HookPill";
import { SubtitleLayer } from "./SubtitleLayer";
import { EmphasisOverlay } from "./EmphasisOverlay";
import { SfxLayer } from "./SfxLayer";
import { ProgressBar } from "./ProgressBar";
import { LogoWatermark } from "./LogoWatermark";
import { secondsToFrames } from "../../utils/time";

// Layout en píxeles sobre el canvas fijo de 1080x1920 (ver
// edit-spec.schema.json: "canvas" es const). Los números replican la
// proporción del reel de referencia (sistema-reels-autopilot.md, sección
// 2): dos tarjetas de video apiladas, cada una con su label arriba, y un
// margen negro entre ellas y en los bordes.
const TOP_LABEL_TOP = 28;
const TOP_PANEL_TOP = 96;
const TOP_PANEL_HEIGHT = 760;
const BOTTOM_LABEL_TOP = 884;
const BOTTOM_PANEL_TOP = 968;
const BOTTOM_PANEL_HEIGHT = 856;

/**
 * Composition "PruebaSocialV1" — template split-screen "antes/después" de
 * la Fábrica de Reels. Estaba reservado en el registro de templates desde
 * el diseño original (sistema-fabrica-reels-nexoia.md, sección 12: "Caption
 * tipo 'quote box', posible layout split-screen antes/después") pero
 * nunca se había construido. Esta es la primera implementación real,
 * validada frame a frame contra un reel de referencia público (ver
 * ../../../../../sistema-reels-autopilot.md para el análisis completo
 * y el prompt de edición reconstruido).
 *
 * Panel superior: el video fuente tal cual, sin cortes ni subtítulos
 * ("Original"). Panel inferior: el MISMO video fuente, con subtítulos y
 * overlays encima ("Editado por [herramienta]") -- igual que en el reel
 * de referencia, donde los dos paneles corren el mismo metraje en
 * paralelo y lo único que cambia es lo que se superpone abajo.
 *
 * Requiere `compare.enabled: true` en el edit_spec; `validateEditSpec()`
 * ya lo exige antes de llegar acá (ver validation/validateEditSpec.ts,
 * regla 9), así que el chequeo de abajo es defensivo, no la validación
 * real.
 */
export const PruebaSocialV1: React.FC<EditSpec> = (spec) => {
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

  if (!spec.compare?.enabled) {
    // No debería pasar nunca -- validateEditSpec() ya lo exige antes del
    // render (regla 9). Mejor un panel negro visible que reventar acá.
    return <AbsoluteFill style={{ backgroundColor: "#000000" }} />;
  }

  const accentColor = spec.compare.bottom_label_accent_color ?? spec.branding.accent_color;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Panel superior: el video fuente "sin tocar", nunca lleva zoom ni subtítulos */}
      <CompareTopLabel text={spec.compare.top_label} top={TOP_LABEL_TOP} />
      <ComparePanelVideo
        videoUrl={spec.source_video.url}
        top={TOP_PANEL_TOP}
        height={TOP_PANEL_HEIGHT}
        badgeText={spec.compare.top_badge_text}
      />

      {/* Panel inferior: el mismo video, con el zoom sutil (si lo hay) */}
      <CompareBottomLabel
        prefix={spec.compare.bottom_label_prefix}
        highlight={spec.compare.bottom_label_highlight}
        accentColor={accentColor}
        top={BOTTOM_LABEL_TOP}
      />
      <ComparePanelVideo
        videoUrl={spec.source_video.url}
        top={BOTTOM_PANEL_TOP}
        height={BOTTOM_PANEL_HEIGHT}
        zoomScale={zoomScale}
      />

      {/* Overlays de énfasis (incluye los mockups de UI, type:"image") */}
      {spec.overlays.map((overlay) => (
        <EmphasisOverlay key={overlay.id} overlay={overlay} width={width} height={height} accentColor={accentColor} />
      ))}

      {/* Hook chico, arriba del panel inferior (ver nota en HookPill.tsx) */}
      <Sequence
        from={secondsToFrames(spec.hook.display_start, fps)}
        durationInFrames={secondsToFrames(spec.hook.display_end - spec.hook.display_start, fps)}
        layout="none"
      >
        <HookPill hook={spec.hook} accentColor={accentColor} top={BOTTOM_PANEL_TOP + 16} />
      </Sequence>

      {/* Efectos de sonido puntuales (whoosh, pop, ding) */}
      <SfxLayer cues={spec.sfx} />

      {/* Subtítulos animados, solo visibles sobre el panel inferior */}
      <SubtitleLayer lines={spec.subtitles.lines} style={spec.subtitles.style} />

      {spec.progress_bar.enabled && <ProgressBar color={spec.progress_bar.color} />}

      <LogoWatermark logoUrl={spec.branding.logo_url} position={spec.branding.watermark_position} />
    </AbsoluteFill>
  );
};
