import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

const DEFAULT_WIDTH_PX = 620;

export const NotificationMockup: React.FC<{
  icon?: string;
  title: string;
  subtitle?: string;
  width?: number;
  canvasWidth: number;
  accentColor: string;
}> = ({ icon, title, subtitle, width, canvasWidth, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 160 }, durationInFrames: 12 });
  // Entra deslizando desde arriba con un pequeño rebote, y queda flotando
  // con un bamboleo lento continuo -- sin esto se siente "pegado" en vez
  // de un elemento real sobre la toma (pedido explícito: "podria tener
  // movimiento").
  const bob = Math.sin(frame / 14) * 6;
  const translateY = (1 - enter) * -90 + bob;

  const cardWidth = (width ?? 0.58) * canvasWidth;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "8%",
        width: cardWidth,
        transform: `translate(-50%, ${translateY}px) scale(${0.9 + enter * 0.1})`,
        opacity: enter,
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "rgba(20,8,10,0.88)",
        border: `1px solid ${accentColor}66`,
        borderRadius: 22,
        padding: "16px 20px",
        boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          minWidth: 44,
          borderRadius: 12,
          backgroundColor: accentColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
        }}
      >
        {icon ?? "💬"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ color: "#FFFFFF", fontWeight: 800, fontSize: 24, lineHeight: 1.15 }}>{title}</span>
        {subtitle && (
          <span style={{ color: "rgba(255,255,255,0.75)", fontWeight: 500, fontSize: 19, lineHeight: 1.15 }}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
};
