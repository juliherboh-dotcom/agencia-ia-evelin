import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

function fontSizeFor(value: string): number {
  const len = value.length;
  if (len <= 3) return 118;
  if (len <= 5) return 100;
  return 82;
}

export const StatNumberCard: React.FC<{
  value: string;
  caption?: string;
  accentColor: string;
  position: { x: number; y: number };
  canvasWidth: number;
  canvasHeight: number;
  durationInFrames?: number;
}> = ({ value, caption, accentColor, position, canvasWidth, canvasHeight, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fromLeft = position.x < 0.5;
  const enter = spring({ frame, fps, config: { damping: 9, stiffness: 200 }, durationInFrames: 10 });
  const slideX = (1 - enter) * (fromLeft ? -50 : 50);
  const bob = Math.sin(frame / 13) * 5;
  const wobble = Math.sin(frame / 19) * 2;

  const exit =
    durationInFrames !== undefined
      ? Math.min(1, Math.max(0, (durationInFrames - frame) / 8))
      : 1;

  const left = position.x * canvasWidth;
  const top = position.y * canvasHeight;
  const align = fromLeft ? "left" : "right";

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        transform: `translate(${fromLeft ? "0%" : "-100%"}, -50%) translate(${slideX}px, ${bob}px) rotate(${wobble}deg) scale(${(0.55 + enter * 0.45) * exit})`,
        opacity: enter * exit,
        textAlign: align,
        fontFamily: "Inter Display, Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: fontSizeFor(value),
          fontWeight: 900,
          color: accentColor,
          lineHeight: 0.9,
          WebkitTextStroke: "3px rgba(0,0,0,0.5)",
          paintOrder: "stroke fill",
        }}
      >
        {value}
      </div>
      {caption && (
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#FFFFFF",
            textTransform: "uppercase",
            letterSpacing: 1,
            marginTop: 4,
            textShadow: "0 2px 6px rgba(0,0,0,0.6)",
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
};
