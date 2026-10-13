import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

const DEFAULT_WIDTH_FRACTION = 0.62;

export const ChecklistMockup: React.FC<{
  title?: string;
  items: { text: string; checked?: boolean }[];
  width?: number;
  canvasWidth: number;
  accentColor: string;
}> = ({ title, items, width, canvasWidth, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 160 }, durationInFrames: 12 });
  const bob = Math.sin(frame / 16) * 5;
  const translateX = (1 - enter) * 60 + bob;

  const cardWidth = (width ?? DEFAULT_WIDTH_FRACTION) * canvasWidth;

  return (
    <div
      style={{
        position: "absolute",
        right: 24,
        top: "20%",
        width: cardWidth,
        transform: `translateX(${translateX}px) scale(${0.92 + enter * 0.08})`,
        opacity: enter,
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
