import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

export const StatNumberCard: React.FC<{
  value: string;
  caption?: string;
  accentColor: string;
}> = ({ value, caption, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 11, stiffness: 190 }, durationInFrames: 10 });
  const bob = Math.sin(frame / 13) * 4;

  return (
    <div
      style={{
        position: "absolute",
        left: 28,
        top: "28%",
        transform: `translateY(${bob}px) scale(${0.6 + enter * 0.4})`,
        opacity: enter,
        textAlign: "left",
        fontFamily: "Inter Display, Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: 96,
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
