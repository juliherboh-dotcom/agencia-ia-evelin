import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

export const BigTitleCard: React.FC<{
  line1: string;
  line2?: string;
  accentColor: string;
}> = ({ line1, line2, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 13, stiffness: 180 }, durationInFrames: 10 });
  const scale = 0.7 + enter * 0.3;

  // Sin tarjeta de fondo -- texto grande directo sobre el video, como en
  // los reels de referencia (palabra en blanco + palabra en color de
  // marca), no un pill con fondo como el overlay type:"text".
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "16%",
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity: enter,
        textAlign: "center",
        fontFamily: "Inter Display, Inter, Arial, sans-serif",
        fontWeight: 900,
        lineHeight: 0.95,
        textTransform: "uppercase",
      }}
    >
      <div
        style={{
          fontSize: 88,
          color: "#FFFFFF",
          WebkitTextStroke: "3px rgba(0,0,0,0.5)",
          paintOrder: "stroke fill",
        }}
      >
        {line1}
      </div>
      {line2 && (
        <div
          style={{
            fontSize: 88,
            color: accentColor,
            WebkitTextStroke: "3px rgba(0,0,0,0.5)",
            paintOrder: "stroke fill",
          }}
        >
          {line2}
        </div>
      )}
    </div>
  );
};
