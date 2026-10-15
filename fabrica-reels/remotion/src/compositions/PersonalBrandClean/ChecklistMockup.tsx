import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

const DEFAULT_WIDTH_FRACTION = 0.62;

export const ChecklistMockup: React.FC<{
  title?: string;
  items: { text: string; checked?: boolean }[];
  width?: number;
  canvasWidth: number;
  canvasHeight: number;
  accentColor: string;
  position: { x: number; y: number };
  durationInFrames?: number;
}> = ({ title, items, width, canvasWidth, canvasHeight, accentColor, position, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fromLeft = position.x < 0.5;
  const enter = spring({ frame, fps, config: { damping: 11, stiffness: 160 }, durationInFrames: 12 });
  const bob = Math.sin(frame / 16) * 5;
  const wobble = Math.sin(frame / 23) * 1.3;
  const translateX = (1 - enter) * (fromLeft ? -60 : 60) + bob;
  const exit =
    durationInFrames !== undefined
      ? Math.min(1, Math.max(0, (durationInFrames - frame) / 8))
      : 1;

  const cardWidth = (width ?? DEFAULT_WIDTH_FRACTION) * canvasWidth;
  const left = position.x * canvasWidth;
  const top = position.y * canvasHeight;

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: cardWidth,
        transform: `translate(-50%, -50%) translateX(${translateX}px) rotate(${wobble}deg) scale(${(0.92 + enter * 0.08) * exit})`,
        opacity: enter * exit,
        background: "rgba(20,8,10,0.88)",
        border: `1px solid ${accentColor}66`,
        borderRadius: 20,
        padding: "18px 20px",
        boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      {title && (
        <div
          style={{
            color: accentColor,
            fontWeight: 800,
            fontSize: 20,
            marginBottom: 10,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {title}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => {
          const itemFrame = frame - i * 4;
          const itemEnter = spring({
            frame: itemFrame,
            fps,
            config: { damping: 14, stiffness: 170 },
            durationInFrames: 8,
          });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                opacity: itemEnter,
                transform: `translateX(${(1 - itemEnter) * 20}px)`,
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  minWidth: 22,
                  borderRadius: 6,
                  backgroundColor: item.checked === false ? "transparent" : accentColor,
                  border: item.checked === false ? `2px solid ${accentColor}` : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  color: "#FFFFFF",
                  fontWeight: 900,
                }}
              >
                {item.checked === false ? "" : "✓"}
              </div>
              <span style={{ color: "#FFFFFF", fontWeight: 700, fontSize: 19 }}>{item.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
