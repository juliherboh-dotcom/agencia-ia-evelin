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
            <CaptionCard line={line} style={style} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const CaptionCard: React.FC<{ line: CaptionLine; style: SubtitleStyle }> = ({ line, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: { damping: 200, stiffness: 260 }, durationInFrames: 8 });

  return (
    <div
      style={{
        position: "absolute",
        maxWidth: "86%",
        textAlign: "center",
        fontFamily: style.font_family,
        fontSize: style.font_size,
        fontWeight: 800,
        lineHeight: 1.15,
        color: line.emphasis ? style.highlight_color : style.color,
        WebkitTextStroke: "6px rgba(0,0,0,0.55)",
        paintOrder: "stroke fill",
        transform: `translateY(${(1 - entrance) * 24}px) scale(${0.9 + entrance * 0.1})`,
        opacity: entrance,
      }}
    >
      {line.text}
    </div>
  );
};
