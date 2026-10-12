import React from "react";
import { AbsoluteFill, OffthreadVideo } from "remotion";

/**
 * Una "tarjeta" de video con esquinas redondeadas, recortada (object-fit:
 * cover) al alto del panel -- no se achica/estira el video, se recorta
 * arriba/abajo igual que en el reel de referencia (ver
 * ../../../../../sistema-reels-autopilot.md, sección 2).
 */
export const ComparePanelVideo: React.FC<{
  videoUrl: string;
  top: number;
  height: number;
  badgeText?: string;
  zoomScale?: number;
}> = ({ videoUrl, top, height, badgeText, zoomScale = 1 }) => (
  <div
    style={{
      position: "absolute",
      top,
      left: 32,
      right: 32,
      height,
      borderRadius: 28,
      overflow: "hidden",
      backgroundColor: "#111111",
      boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
    }}
  >
    <AbsoluteFill style={{ transform: `scale(${zoomScale})`, transformOrigin: "center center" }}>
      <OffthreadVideo
        src={videoUrl}
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }}
      />
    </AbsoluteFill>

    {badgeText && (
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          padding: "6px 14px",
          borderRadius: 8,
          backgroundColor: "rgba(0,0,0,0.55)",
          color: "#FFFFFF",
          fontFamily: "Manrope, Arial, sans-serif",
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: 0.3,
        }}
      >
        {badgeText}
      </div>
    )}
  </div>
);
