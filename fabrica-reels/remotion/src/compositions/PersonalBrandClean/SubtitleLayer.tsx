import React from "react";
import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionLine, EditSpec } from "../../../../schema/edit-spec.zod";
import { secondsToFrames } from "../../utils/time";

type SubtitleStyle = EditSpec["subtitles"]["style"];

const POSITION_STYLE: Record<SubtitleStyle["position"], React.CSSProperties> = {
  top: { justifyContent: "flex-start", paddingTop: 260 },
  center: { justifyContent: "center" },
  bottom: { justifyContent: "flex-end", paddingBottom: 340 },
};

// Dos familias tipográficas reales (instaladas en el entorno de render --
// "Manrope", que se pedía antes en subtitles.style.font_family, no existe
// acá y caía en un serif de reemplazo sin que nadie lo notara). Los
// renglones normales usan Inter ExtraBold; los de énfasis saltan a Inter
// Display Black, más grande, para la variedad de tamaño/tipografía pedida.
const FONT_NORMAL = "Inter";
const FONT_EMPHASIS = "Inter Display";

export const SubtitleLayer: React.FC<{
  lines: CaptionLine[];
  style: SubtitleStyle;
}> = ({ lines, style }) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ alignItems: "center", ...POSITION_STYLE[style.position] }}>
      {lines.map((line, i) => {
        const from = secondsToFrames(line.start, fps);
        const duration = secondsToFrames(line.end - line.start, fps);
        return (
          <Sequence key={`${i}-${line.start}`} from={from} durationInFrames={duration} layout="none">
            <CaptionCard line={line} style={style} index={i} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const CaptionCard: React.FC<{ line: CaptionLine; style: SubtitleStyle; index: number }> = ({ line, style, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: { damping: 12, stiffness: 180, mass: 0.6 }, durationInFrames: 10 });

  // Alterna de qué lado "entra" cada renglón (izquierda/derecha) para que
  // el movimiento no se sienta repetitivo renglón tras renglón.
  const side = index % 2 === 0 ? -1 : 1;
  const slideX = (1 - entrance) * 44 * side;
  const wobbleDeg = (1 - entrance) * side * 5;

  const fontFamily = line.emphasis ? FONT_EMPHASIS : FONT_NORMAL;
  const fontWeight = line.emphasis ? 900 : 800;
  const fontSize = line.emphasis ? Math.round(style.font_size * 1.3) : style.font_size;

  return (
    <div
      style={{
        position: "absolute",
        maxWidth: "86%",
        textAlign: "center",
        fontFamily,
        fontSize,
        fontWeight,
        lineHeight: 1.1,
        color: line.emphasis ? style.highlight_color : style.color,
        WebkitTextStroke: "6px rgba(0,0,0,0.55)",
        paintOrder: "stroke fill",
        transform: `translate(${slideX}px, ${(1 - entrance) * 26}px) scale(${0.85 + entrance * 0.15}) rotate(${wobbleDeg}deg)`,
        opacity: entrance,
      }}
    >
      {line.text}
    </div>
  );
};
