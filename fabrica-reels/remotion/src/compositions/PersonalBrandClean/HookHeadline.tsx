import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditSpec } from "../../../../schema/edit-spec.zod";

export const HookHeadline: React.FC<{
  hook: EditSpec["hook"];
  accentColor: string;
}> = ({ hook, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: { damping: 14, mass: 0.6 }, durationInFrames: 12 });

  const emphasisSet = new Set(hook.emphasis_words.map((w) => w.toLowerCase()));
  const words = hook.text.split(" ");

  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 96 }}>
      <div
        style={{
          maxWidth: "88%",
          textAlign: "center",
          fontFamily: "Manrope, Arial, sans-serif",
          fontSize: 64,
          fontWeight: 800,
          lineHeight: 1.08,
          color: "#FFFFFF",
          WebkitTextStroke: "7px rgba(0,0,0,0.6)",
          paintOrder: "stroke fill",
          transform: `scale(${0.85 + entrance * 0.15})`,
          opacity: entrance,
        }}
      >
        {words.map((word, i) => {
          const clean = word.toLowerCase().replace(/[.,!?]/g, "");
          const isEmphasis = emphasisSet.has(clean);
          return (
            <span key={i} style={{ color: isEmphasis ? accentColor : "#FFFFFF" }}>
              {word}{" "}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
